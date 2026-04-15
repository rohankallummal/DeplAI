import asyncio
import json
import logging
import os
import queue as thread_queue
import uuid

from fastapi import WebSocket

from models import CustomizeValidationRequest, StreamStatus
from runner_base import RunnerBase
from utils import (
    get_docker_client,
    get_or_create_customize_container,
    CUSTOMIZE_CODE_VOLUME,
    decode_output,
)
from publish import save_local_changes, create_customize_pr

logger = logging.getLogger(__name__)

TOTAL_STEPS = 8


class CustomizationRunner(RunnerBase):

    def __init__(self, websocket: WebSocket, project_id: str, context: CustomizeValidationRequest):
        super().__init__(websocket, TOTAL_STEPS)
        self.project_id = project_id
        self.context = context
        self._container = None

        self._chat_event = asyncio.Event()
        self._chat_message: str | None = None

        self._diff_response_event = asyncio.Event()
        self._diff_response_data: dict | None = None

        self._changes_made = False
        self._agent_done = asyncio.Event()

    @property
    def changes_made(self) -> bool:
        return self._changes_made

    @property
    def _codebase_path(self) -> str:
        if self.context.project_type == "github":
            return "/workspace/codebase"
        return "/workspace/codebase/edited"

    def cancel(self):
        super().cancel()
        if self._container:
            try:
                self._container.exec_run(
                    ["sh", "-c", "pkill -f pipeline.py; pkill -f diff_daemon"],
                    detach=True,
                )
            except Exception:
                pass

    async def receive_chat_message(self, message: str):
        self._chat_message = message
        self._chat_event.set()

    async def receive_diff_response(self, diff_id: str, approved: bool):
        self._diff_response_data = {"diff_id": diff_id, "approved": approved}
        self._diff_response_event.set()

    async def _run_pipeline(self) -> bool:
        logger.info("Preparing customize container")
        self._container = await asyncio.to_thread(get_or_create_customize_container)
        self._check_cancelled()

        # Copy codebase into volume
        await self._send_status(StreamStatus.preparing)
        logger.info(f"Copying codebase into Docker volume for project {self.project_id}")
        success, error_msg = await asyncio.to_thread(self._copy_codebase_to_volume)
        if not success:
            logger.error(f"Failed to copy codebase: {error_msg}")
            return await self._terminate("Something went wrong preparing your project. Please try again.")
        self._check_cancelled()

        # Set permissions
        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "chmod 666 /var/run/docker.sock 2>/dev/null; "
                "chown -R agent:agent /workspace /home/agent 2>/dev/null; "
                "chmod -R a+r /app 2>/dev/null",
            ],
            user="root",
        )

        # For local projects, create a snapshot marker so _extract_changes
        # can later find which files the agents modified.
        if self.context.project_type == "local":
            await asyncio.to_thread(
                self._container.exec_run,
                ["touch", "/workspace/codebase/.snapshot_marker"],
                user="agent",
            )

        # Clear stale work artifacts from previous sessions (pending
        # diffs, file backups, etc.) before starting the diff daemon.
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", "rm -rf /workspace/customize/* /workspace/customize/.[!.]* 2>/dev/null || true"],
            user="agent",
        )

        # Start diff daemon (eliminates ~100-300ms Python cold-start per Edit call)
        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "pkill -f diff_daemon 2>/dev/null; sleep 0.2; "
                "nohup python3 /app/hooks/diff_daemon.py > /dev/null 2>&1 &",
            ],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        await asyncio.sleep(0.3)
        logger.info("Diff daemon started")

        # Verify Claude CLI
        exit_code, diag_output = await asyncio.to_thread(
            self._container.exec_run,
            ["claude", "--version"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        diag_text = decode_output(diag_output).strip()
        if exit_code != 0:
            logger.error(f"Claude CLI check failed (exit {exit_code}): {diag_text}")
            return await self._terminate("Something went wrong. Please try again.")
        logger.info(f"Claude CLI ready ({diag_text})")

        # Wait for user's customization request
        await self._send_status(StreamStatus.running)
        logger.info("Waiting for user customization request")
        await self._chat_event.wait()
        self._check_cancelled()

        if self._chat_message is None:
            return await self._terminate("No customization request received")

        # Execute changes with diff monitoring
        await self._send_status(StreamStatus.executing)
        logger.info("Starting styler agent")

        self._agent_done.clear()
        execute_task = asyncio.create_task(self._run_agent_phase(
            "execute",
            extra_args=["--user-request", self._chat_message],
        ))
        monitor_task = asyncio.create_task(self._monitor_diffs())

        execute_result = await execute_task
        self._agent_done.set()
        await monitor_task

        if not execute_result or not execute_result.get("success"):
            if self._changes_made:
                logger.warning("Styler had errors but some changes were applied")
            else:
                return await self._terminate("Something went wrong. Please try again.")

        # Run Builder agent to verify build stability
        if self._changes_made:
            await self._run_builder()

        # For local projects, copy only the files that agents actually
        # touched into ``original/`` so the save step can skip everything
        # else.  GitHub projects don't need this — git handles change
        # detection and .gitignore handles build artifacts.
        if self.context.project_type == "local":
            await self._extract_changes()

        await self._send_status(StreamStatus.completed)
        await self._send_result({
            "success": True,
            "changes_made": self._changes_made,
        })
        return True

    async def _handle_diff_approval(self, diff_data: dict) -> bool:
        """Send a file-level diff to the frontend and wait for approval.
        Returns True if the user approved."""
        await self._try_send({
            "type": "diff_preview",
            "data": diff_data,
        })
        await self._send_status(StreamStatus.waiting_diff)

        self._diff_response_event.clear()
        await self._diff_response_event.wait()

        approved = bool(
            self._diff_response_data and self._diff_response_data.get("approved")
        )
        if approved:
            self._changes_made = True

        # Write response so the hook (if still polling) can unblock
        response_json = json.dumps(self._diff_response_data or {"approved": False})
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", f"cat > /workspace/customize/diff_response.json << 'DIFF_EOF'\n{response_json}\nDIFF_EOF"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        self._diff_response_data = None
        await self._send_status(StreamStatus.executing)
        return approved

    async def _monitor_diffs(self):
        """Watch for pending file-level diffs and relay to frontend.
        Uses inotifywait for event-driven detection instead of polling."""
        while not self._cancelled and not self._agent_done.is_set():
            try:
                # Check if a pending diff already exists
                exit_code, output = await asyncio.to_thread(
                    self._container.exec_run,
                    ["cat", "/workspace/customize/pending_diff.json"],
                    user="agent",
                )
                if exit_code == 0:
                    try:
                        diff_data = json.loads(decode_output(output))
                    except json.JSONDecodeError:
                        pass
                    else:
                        # Remove immediately to prevent re-read on next iteration
                        await asyncio.to_thread(
                            self._container.exec_run,
                            ["rm", "-f", "/workspace/customize/pending_diff.json"],
                            user="agent",
                        )
                        await self._handle_diff_approval(diff_data)
                        continue

                # No diff pending — block until the file appears (1s timeout for cancellation checks)
                await asyncio.to_thread(
                    self._container.exec_run,
                    [
                        "inotifywait", "-qq", "-t", "1",
                        "-e", "close_write,create",
                        "--include", "pending_diff\\.json",
                        "/workspace/customize/",
                    ],
                    user="agent",
                )
            except Exception:
                pass

        # Agent finished — flush remaining edits for the last file
        await self._flush_remaining_edits()

    async def _flush_remaining_edits(self):
        """Send any accumulated edits that haven't been reviewed yet
        (the last file the agent touched has no file-transition to trigger review).
        Queries the diff daemon for in-memory state instead of reading files."""
        if self._cancelled:
            return
        try:
            # Handle any pending diff the monitor loop might have missed
            # (e.g., daemon wrote pending_diff.json right as agent finished)
            ec, output = await asyncio.to_thread(
                self._container.exec_run,
                ["cat", "/workspace/customize/pending_diff.json"],
                user="agent",
            )
            if ec == 0:
                try:
                    diff_data = json.loads(decode_output(output))
                    await asyncio.to_thread(
                        self._container.exec_run,
                        ["rm", "-f", "/workspace/customize/pending_diff.json"],
                        user="agent",
                    )
                    await self._handle_diff_approval(diff_data)
                    # Give daemon time to process the response and return to accept()
                    await asyncio.sleep(0.5)
                except json.JSONDecodeError:
                    pass

            # Query daemon for remaining accumulated hunks (last file)
            state = None
            for _attempt in range(5):
                ec, output = await asyncio.to_thread(
                    self._container.exec_run,
                    [
                        "sh", "-c",
                        "printf '{\"action\":\"get_state\"}' | "
                        "socat -t5 - UNIX-CONNECT:/workspace/customize/hook.sock 2>/dev/null",
                    ],
                    user="agent",
                )
                if ec == 0:
                    try:
                        state = json.loads(decode_output(output))
                        break
                    except json.JSONDecodeError:
                        pass
                await asyncio.sleep(0.3)

            if not state:
                return

            hunks = state.get("hunks", [])
            file_path = state.get("current_file", "")

            if not hunks or not file_path:
                return

            # Sort hunks by first line number so diffs read top-to-bottom
            def _hunk_sort_key(h):
                for line in h.get("lines", []):
                    if "num" in line:
                        return line["num"]
                return float("inf")
            hunks.sort(key=_hunk_sort_key)

            # Merge overlapping context between adjacent hunks
            if len(hunks) > 1:
                merged = [{"lines": list(hunks[0]["lines"])}]
                for hunk in hunks[1:]:
                    prev = merged[-1]
                    prev_lines = prev["lines"]
                    curr_lines = list(hunk["lines"])
                    if not prev_lines or not curr_lines:
                        merged.append({"lines": curr_lines})
                        continue
                    prev_max = max(l["num"] for l in prev_lines)
                    curr_min = min(l["num"] for l in curr_lines)
                    if curr_min <= prev_max:
                        curr_edit_nums = set(l["num"] for l in curr_lines if l["type"] != "ctx")
                        trimmed_prev = [l for l in prev_lines if not (l["type"] == "ctx" and l["num"] in curr_edit_nums)]
                        trimmed_curr = [l for l in curr_lines if not (l["type"] == "ctx" and l["num"] <= prev_max)]
                        prev["lines"] = trimmed_prev + trimmed_curr
                    else:
                        merged.append({"lines": curr_lines})
                hunks = merged

            diff_data = {
                "diff_id": str(uuid.uuid4()),
                "file_path": file_path,
                "hunks": hunks,
            }

            approved = await self._handle_diff_approval(diff_data)
            if not approved:
                # Revert the file from backup
                await asyncio.to_thread(
                    self._container.exec_run,
                    ["sh", "-c", f"cp /workspace/customize/file_backup '{file_path}'"],
                    user="agent",
                )

            # Clean up backup
            await asyncio.to_thread(
                self._container.exec_run,
                ["sh", "-c", "rm -f /workspace/customize/file_backup"],
                user="agent",
            )
        except Exception as e:
            logger.debug("Flush remaining edits: %s", e)

    _EXTRACT_EXCLUDE_DIRS = [
        "node_modules", ".next", "dist", "build",
        ".cache", "__pycache__", ".venv", "venv",
        ".turbo", ".swc", ".git",
    ]

    async def _extract_changes(self):
        """Find source files in ``edited/`` that agents modified (newer
        than the snapshot marker) and copy them into ``original/``.
        Build-artifact directories are skipped."""
        find_prunes = " -o ".join(
            f"-name '{d}'" for d in self._EXTRACT_EXCLUDE_DIRS
        )
        script = (
            "cd /workspace/codebase/edited && "
            f"find . -mindepth 1 \\( {find_prunes} \\) -prune -o "
            "-newer /workspace/codebase/.snapshot_marker -type f -print | "
            "while IFS= read -r f; do "
            "  mkdir -p \"/workspace/codebase/original/$(dirname \"$f\")\"; "
            "  cp \"$f\" \"/workspace/codebase/original/$f\"; "
            "done"
        )
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", script],
            user="agent",
        )
        logger.info("Changed files extracted to original/")

    async def _run_builder(self):
        """Run the Builder agent to verify build stability after Styler changes."""
        self._check_cancelled()
        await self._send_status(StreamStatus.building)
        await self._try_send({"type": "builder_status", "data": {"status": "running"}})
        logger.info("Starting builder agent")

        build_result = await self._run_agent_phase("build")
        self._check_cancelled()

        if build_result and build_result.get("success"):
            await self._try_send({"type": "builder_status", "data": {"status": "passed"}})
            logger.info("Build passed")
        else:
            await self._try_send({"type": "builder_status", "data": {"status": "fixing"}})
            await self._send_status(StreamStatus.build_fixing)
            logger.warning("Build failed, builder is attempting fixes")

            # The builder agent already attempts fixes internally (up to 3 attempts).
            # If it still returned failure, report it but don't block the pipeline.
            await self._try_send({"type": "builder_status", "data": {"status": "failed"}})
            logger.warning("Builder could not resolve all build errors")

    async def _run_agent_phase(self, phase: str, extra_args: list[str] | None = None) -> dict | None:
        cmd = [
            "python", "-m", "pipeline",
            "--phase", phase,
            "--project-name", self.context.project_name,
            "--project-id", self.project_id,
            "--codebase-path", self._codebase_path,
        ]
        if extra_args:
            cmd.extend(extra_args)

        msg_q: thread_queue.Queue = thread_queue.Queue()

        environment = {
            "HOME": "/home/agent",
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "USER": "agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        }

        def _read_exec_output():
            buffer = ""
            try:
                # Redirect stderr to stdout so we capture error details
                wrapped_cmd = ["sh", "-c", " ".join(f"'{c}'" for c in cmd) + " 2>&1"]
                _, output = self._container.exec_run(
                    wrapped_cmd, stream=True, workdir="/app", user="agent",
                    environment=environment,
                )
                for chunk in output:
                    buffer += chunk.decode(errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            parsed = json.loads(line)
                            msg_q.put(parsed)
                        except json.JSONDecodeError:
                            msg_q.put({"type": "error", "content": line})
                if buffer.strip():
                    try:
                        parsed = json.loads(buffer.strip())
                        msg_q.put(parsed)
                    except json.JSONDecodeError:
                        msg_q.put({"type": "error", "content": buffer.strip()})
            except Exception as e:
                logger.debug("Exec stream ended: %s", e)
            finally:
                msg_q.put(None)

        asyncio.get_running_loop().run_in_executor(None, _read_exec_output)

        result = None
        while True:
            msg = await asyncio.to_thread(msg_q.get)
            if msg is None:
                break
            if self._cancelled:
                break
            if msg.get("type") == "result":
                result = msg.get("data")
            else:
                msg_type = msg.get("type", "info")
                msg_content = msg.get("content", "")
                if msg_type == "error":
                    logger.error(msg_content)
                else:
                    logger.info(f"[{msg_type.upper()}] {msg_content}")

        return result

    async def save_changes(self) -> dict:
        """Save changes based on project type."""
        await self._send_status(StreamStatus.saving)

        if self.context.project_type == "local":
            success, message = await asyncio.to_thread(
                save_local_changes,
                self.project_id,
                self.context.user_id,
            )
            result = {"success": success, "message": message}
        elif self.context.project_type == "github":
            if not self.context.github_token or not self.context.owner or not self.context.repo:
                result = {"success": False, "message": "Missing GitHub credentials"}
            else:
                success, message, url = await asyncio.to_thread(
                    create_customize_pr,
                    self.project_id,
                    self.context.github_token,
                    self.context.owner,
                    self.context.repo,
                    self.context.default_branch or "main",
                )
                result = {"success": success, "message": message, "url": url}
        else:
            result = {"success": False, "message": f"Unknown project type: {self.context.project_type}"}

        await self._try_send({"type": "save_result", "data": result})
        return result

    async def discard_changes(self):
        """Discard changes by clearing volumes."""
        await asyncio.to_thread(self._clear_volumes)

    def _copy_codebase_to_volume(self) -> tuple[bool, str]:
        """Copy codebase from host into the ``edited/`` subdirectory of
        the Docker volume.  An empty ``original/`` directory is created
        alongside it to receive only the changed files later."""
        try:
            if self.context.project_type == "github":
                return self._clone_github_repo()

            uid, pid = self.context.user_id, self.project_id
            host_base = os.environ.get("HOST_PROJECTS_DIR")
            if host_base:
                check_path = os.path.join("/local-projects", uid, pid)
                host_path = os.path.join(host_base, uid, pid)
            else:
                host_path = os.path.abspath(
                    os.path.join(os.path.dirname(__file__), "..", "Connector", "tmp", "local-projects", uid, pid)
                )
                check_path = host_path

            if not os.path.isdir(check_path):
                return (False, f"Codebase directory not found at {check_path}")

            logger.info(f"Copying codebase from {host_path} to Docker volume")

            self._container.exec_run(
                ["sh", "-c",
                 "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* 2>/dev/null || true; "
                 "mkdir -p /workspace/codebase/edited /workspace/codebase/original"],
                user="agent",
            )

            copy_ctr = get_docker_client().containers.run(
                "alpine",
                command=["sh", "-c", "cp -a /src/. /vol/edited/ && echo Success || echo Failed"],
                volumes={
                    CUSTOMIZE_CODE_VOLUME: {"bind": "/vol", "mode": "rw"},
                    host_path: {"bind": "/src", "mode": "ro"},
                },
                detach=True,
            )
            try:
                copy_ctr.wait()
                decoded = decode_output(copy_ctr.logs())
            finally:
                try:
                    copy_ctr.remove(force=True)
                except Exception:
                    pass
            if "Success" in decoded:
                logger.info("Codebase copied to Docker volume")
                return (True, "")
            return (False, f"Copy failed: {decoded}")
        except Exception as e:
            return (False, str(e))

    def _clone_github_repo(self) -> tuple[bool, str]:
        """Clone GitHub repository directly into the volume root.
        If a previous customization branch exists on the remote, check
        it out so changes accumulate across sessions."""
        try:
            token = self.context.github_token
            repo_url = self.context.repository_url

            if not repo_url or not token:
                return (False, "Missing repository URL or GitHub token")

            clone_url = repo_url.replace(
                "https://github.com/",
                f"https://x-access-token:{token}@github.com/",
            )
            if not clone_url.endswith(".git"):
                clone_url += ".git"

            self._container.exec_run(
                ["sh", "-c", "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* 2>/dev/null || true"],
                user="root",
            )

            branch_name = f"deplai/customize-{self.project_id}"

            # Clone, then check out the existing customization branch if
            # it exists on the remote.  If it doesn't, stay on the
            # default branch (first session).
            clone_script = (
                f"git clone {clone_url} /repo && "
                f"cd /repo && "
                f"git fetch origin {branch_name} 2>/dev/null && "
                f"git checkout {branch_name} 2>/dev/null || true"
            )

            clone_ctr = get_docker_client().containers.run(
                "alpine/git",
                entrypoint="sh",
                command=["-c", clone_script],
                volumes={CUSTOMIZE_CODE_VOLUME: {"bind": "/repo", "mode": "rw"}},
                tmpfs={"/git": ""},
                detach=True,
            )
            try:
                clone_ctr.wait()
            finally:
                try:
                    clone_ctr.remove(force=True)
                except Exception:
                    pass
            logger.info("GitHub repo cloned into volume")
            return (True, "")
        except Exception as e:
            logger.error("Failed to clone GitHub repo: %s", e)
            return (False, str(e))

    def _clear_volumes(self):
        """Clear contents of both volumes."""
        try:
            self._container.exec_run(
                [
                    "sh", "-c",
                    "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* "
                    "/workspace/customize/* /workspace/customize/.[!.]* /workspace/customize/..?* 2>/dev/null || true",
                ],
                user="agent",
            )
            logger.info("Volumes cleared")
        except Exception as e:
            logger.error("Failed to clear volumes: %s", e)
