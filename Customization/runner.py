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

    def cancel(self):
        super().cancel()
        if self._container:
            try:
                self._container.exec_run(
                    ["pkill", "-f", "pipeline.py"],
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
        execute_task = asyncio.create_task(self._run_agent_phase_async(
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
        """Poll for pending file-level diffs and relay to frontend."""
        while not self._cancelled and not self._agent_done.is_set():
            try:
                exit_code, output = await asyncio.to_thread(
                    self._container.exec_run,
                    ["cat", "/workspace/customize/pending_diff.json"],
                    user="agent",
                )
                if exit_code == 0:
                    diff_data = json.loads(decode_output(output))
                    await self._handle_diff_approval(diff_data)
            except json.JSONDecodeError:
                pass
            except Exception:
                pass

            await asyncio.sleep(0.5)

        # Agent finished — flush remaining edits for the last file
        await self._flush_remaining_edits()

    async def _flush_remaining_edits(self):
        """Send any accumulated edits that haven't been reviewed yet
        (the last file the agent touched has no file-transition to trigger review)."""
        if self._cancelled:
            return
        try:
            ec_acc, out_acc = await asyncio.to_thread(
                self._container.exec_run,
                ["cat", "/workspace/customize/edit_accumulator.json"],
                user="agent",
            )
            if ec_acc != 0:
                return
            hunks = json.loads(decode_output(out_acc))
            if not hunks:
                return

            ec_fp, out_fp = await asyncio.to_thread(
                self._container.exec_run,
                ["cat", "/workspace/customize/current_edit_file.txt"],
                user="agent",
            )
            if ec_fp != 0:
                return
            file_path = decode_output(out_fp).strip()
            if not file_path:
                return

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

            # Clean up state files
            await asyncio.to_thread(
                self._container.exec_run,
                ["sh", "-c", "rm -f /workspace/customize/edit_accumulator.json "
                             "/workspace/customize/current_edit_file.txt "
                             "/workspace/customize/file_backup"],
                user="agent",
            )
        except Exception as e:
            logger.debug("Flush remaining edits: %s", e)

    async def _run_agent_phase_async(self, phase: str, extra_args: list[str] | None = None) -> dict | None:
        """Run agent phase and return result. Used with asyncio.create_task."""
        return await self._run_agent_phase(phase, extra_args=extra_args)

    async def _run_agent_phase(self, phase: str, extra_args: list[str] | None = None) -> dict | None:
        cmd = [
            "python", "-m", "pipeline",
            "--phase", phase,
            "--project-name", self.context.project_name,
            "--project-id", self.project_id,
        ]
        if extra_args:
            cmd.extend(extra_args)

        msg_q: thread_queue.Queue = thread_queue.Queue()

        environment = {
            "HOME": "/home/agent",
            "PATH": "/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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

        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, _read_exec_output)

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
        """Copy codebase from host into Docker volume."""
        try:
            user_id = self.context.user_id
            project_id = self.project_id

            if self.context.project_type == "github":
                return self._clone_github_repo()

            host_base = os.environ.get("HOST_PROJECTS_DIR")
            if host_base:
                check_path = os.path.join("/local-projects", user_id, project_id)
                host_path = os.path.join(host_base, user_id, project_id)
            else:
                host_path = os.path.abspath(
                    os.path.join(
                        os.path.dirname(__file__), "..", "Connector", "tmp",
                        "local-projects", user_id, project_id,
                    )
                )
                check_path = host_path

            if not os.path.isdir(check_path):
                return (False, f"Codebase directory not found at {check_path}")

            logger.info(f"Copying codebase from {host_path} to Docker volume")

            self._container.exec_run(
                ["sh", "-c", "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* 2>/dev/null || true"],
                user="agent",
            )

            try:
                output = get_docker_client().containers.run(
                    "alpine",
                    command=["sh", "-c", "cp -a /src/. /workspace/codebase/ && echo Success || echo Failed"],
                    volumes={
                        CUSTOMIZE_CODE_VOLUME: {"bind": "/workspace/codebase", "mode": "rw"},
                        host_path: {"bind": "/src", "mode": "ro"},
                    },
                    remove=True,
                )
                decoded = decode_output(output)
                if "Success" in decoded:
                    logger.info("Codebase copied to Docker volume")
                    return (True, "")
                return (False, f"Copy failed: {decoded}")
            except Exception as e:
                return (False, str(e))
        except Exception as e:
            return (False, str(e))

    def _clone_github_repo(self) -> tuple[bool, str]:
        """Clone GitHub repository into Docker volume."""
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
                user="agent",
            )

            get_docker_client().containers.run(
                "alpine/git",
                command=["clone", clone_url, "/repo"],
                volumes={CUSTOMIZE_CODE_VOLUME: {"bind": "/repo", "mode": "rw"}},
                tmpfs={"/git": ""},
                remove=True,
            )
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
