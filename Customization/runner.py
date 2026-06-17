import asyncio
import json
import logging
import os
import queue as thread_queue

from fastapi import WebSocket

from diff_state import DiffTracker, diff_id_for
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
DIFF_POLL_INTERVAL_SECONDS = 0.7
# Bounded escape hatch: how long finalize waits for the user to decide remaining
# diffs before ending the session without saving. Resets on each decision.
AWAITING_DECISIONS_TIMEOUT_SECONDS = 1800  # 30 min


class CustomizationRunner(RunnerBase):

    def __init__(self, websocket: WebSocket, project_id: str, context: CustomizeValidationRequest):
        super().__init__(websocket, TOTAL_STEPS)
        self.project_id = project_id
        self.context = context
        self._container = None

        self._chat_event = asyncio.Event()
        self._chat_message: str | None = None

        self._diffs = DiffTracker()
        self._decision_event = asyncio.Event()

        self._changes_made = False
        self._iteration_changes_made = False

    @property
    def changes_made(self) -> bool:
        return self._changes_made

    @property
    def _project_dir(self) -> str:
        return f"/workspace/codebase/{self.project_id}"

    @property
    def _codebase_path(self) -> str:
        if self.context.project_type == "github":
            return self._project_dir
        return f"{self._project_dir}/edited"

    def cancel(self):
        super().cancel()
        # Wake any parked waits so the workflow loop observes cancellation and
        # unwinds instead of leaking a parked coroutine.
        self._chat_event.set()
        self._decision_event.set()
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

    async def receive_diff_response(self, diff_id: str, approved: bool, rev: int = 0):
        # Out-of-band: recorded against the rev the user actually reviewed, so a
        # concurrent re-edit re-opens the box instead of approving stale content.
        self._diffs.record_decision(diff_id, approved, rev)
        self._decision_event.set()

    async def _run_pipeline(self) -> bool:
        logger.info("Preparing customize container")
        self._container = await asyncio.to_thread(get_or_create_customize_container)
        self._check_cancelled()

        await self._send_status(StreamStatus.preparing)
        logger.info(f"Copying codebase into Docker volume for project {self.project_id}")
        success, error_msg = await asyncio.to_thread(self._copy_codebase_to_volume)
        if not success:
            logger.error(f"Failed to copy codebase: {error_msg}")
            return await self._terminate("Something went wrong preparing your project. Please try again.")
        self._check_cancelled()

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

        if self.context.project_type == "local":
            await asyncio.to_thread(
                self._container.exec_run,
                ["sh", "-c", self._snapshot_baseline_script()],
                user="agent",
            )

        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", "mkdir -p /workspace/work && rm -rf /workspace/work/* /workspace/work/.[!.]* 2>/dev/null || true"],
            user="agent",
        )

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

        while True:
            await self._send_status(StreamStatus.running)
            logger.info("Waiting for user customization request")
            await self._chat_event.wait()
            self._check_cancelled()

            prompt = self._chat_message
            self._chat_event.clear()
            self._chat_message = None
            self._iteration_changes_made = False

            if prompt is None:
                continue

            await self._send_status(StreamStatus.executing)
            logger.info("Starting styler agent")

            if self.context.project_type == "local" and not self._cancelled:
                await self._capture_iter_snapshot()

            self._diffs.reset()
            poller = asyncio.create_task(self._poll_diffs())
            try:
                execute_result = await self._run_agent_phase(
                    "execute",
                    extra_args=["--user-request", prompt],
                )
            finally:
                poller.cancel()
                try:
                    await poller
                except asyncio.CancelledError:
                    pass

            await self._finalize_diffs()
            self._check_cancelled()

            # Capture what actually changed on disk this iteration. For local
            # projects the filesystem is the source of truth: the agent may
            # create / delete / rename / recreate files via Write, rm, mv or
            # shell commands — operations that never set the Edit-approval flag.
            # So run extraction unconditionally and derive the change state from
            # what was promoted or deleted, not from approved Edit diffs.
            iteration_changed = self._iteration_changes_made
            if self.context.project_type == "local" and not self._cancelled:
                if await self._extract_changes():
                    iteration_changed = True
                    self._changes_made = True
                await self._announce_file_events()

            if not execute_result or not execute_result.get("success"):
                if iteration_changed:
                    logger.warning("Styler had errors but some changes were applied this iteration")
                else:
                    logger.error("Styler failed; awaiting next user request")
                    await self._try_send({"type": "error", "data": "Something went wrong. Please try again."})
                    await self._send_status(StreamStatus.error)
                    continue

            if iteration_changed:
                await self._run_builder()
                # The builder may edit files to fix the build; re-capture so its
                # changes are promoted into original/ too (idempotent recompute).
                if self.context.project_type == "local" and not self._cancelled:
                    await self._extract_changes()

            await self._send_status(StreamStatus.completed)
            await self._send_result({
                "success": True,
                "changes_made": self._changes_made,
            })

    async def _finalize_diffs(self):
        """After execute exits the agent is the only edit source, so the
        filesystem is frozen. Take an authoritative final peek, wait until every
        file is settled (decided at its latest rev) bounded by a timeout, then
        apply rollbacks for rejected files and drain the daemon."""
        if self._cancelled:
            return

        # Authoritative final peek. The agent has exited, so this snapshot is
        # complete — but a single missed peek here could let last-moment edits be
        # finalized without review, so retry a few times on transient failure.
        for _attempt in range(5):
            if await self._emit_pending_diffs():
                break
            await asyncio.sleep(0.3)

        if self._diffs.has_unsettled():
            await self._send_status(StreamStatus.awaiting_decisions)
        while not self._cancelled:
            self._decision_event.clear()
            if not self._diffs.has_unsettled():
                break
            try:
                await asyncio.wait_for(
                    self._decision_event.wait(),
                    timeout=AWAITING_DECISIONS_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                logger.warning("Awaiting-decisions timed out for %s; ending session", self.project_id)
                await self._try_send({
                    "type": "error",
                    "data": "Review timed out — the session was closed without saving. Please start again.",
                })
                await self._send_status(StreamStatus.error)
                self.cancel()
                return

        if self._cancelled:
            return

        for rec in self._diffs.records.values():
            if self._cancelled:
                return
            if rec.decision == "approved":
                self._changes_made = True
                self._iteration_changes_made = True
            elif rec.decision == "rejected" and rec.backup:
                # -p preserves the pre-edit mtime so _extract_changes does not
                # re-promote a rejected file.
                await asyncio.to_thread(
                    self._container.exec_run,
                    ["sh", "-c", f"cp -p '{rec.backup}' '{rec.file_path}'"],
                    user="agent",
                )

        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "printf '{\"action\":\"reset\"}' | "
                "socat -t5 - UNIX-CONNECT:/workspace/work/hook.sock 2>/dev/null; "
                "rm -rf /workspace/work/backups",
            ],
            user="agent",
        )
        self._diffs.reset()

    @staticmethod
    def _hunk_sort_key(h: dict) -> int | float:
        for line in h.get("lines", []):
            if "num" in line:
                return line["num"]
        return float("inf")

    @staticmethod
    def _merge_overlapping_hunks(hunks: list) -> list:
        if len(hunks) <= 1:
            return hunks
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
        return merged

    _EXTRACT_EXCLUDE_DIRS = [
        "node_modules", ".next", "dist", "build",
        ".cache", "__pycache__", ".venv", "venv",
        ".turbo", ".swc", ".git",
    ]

    def _find_prunes(self) -> str:
        """Prune expression shared by every file scan (snapshot baseline,
        current scan, and modification extraction) so they enumerate an
        identical set of tracked files. _EXTRACT_EXCLUDE_DIRS is the single
        source of truth."""
        return " -o ".join(f"-name '{d}'" for d in self._EXTRACT_EXCLUDE_DIRS)

    def _list_tracked_files_cmd(self) -> str:
        """Pipeline (run from edited/) listing every tracked file in ./relative
        form, pruned identically to _extract_changes and sorted with a stable
        C-locale collation so two such lists can be diffed with `comm`."""
        return (
            f"find . -mindepth 1 \\( {self._find_prunes()} \\) -prune -o "
            "-type f -print | LC_ALL=C sort"
        )

    def _snapshot_baseline_script(self) -> str:
        """Lay down both baselines at the same instant: the mtime baseline
        (.snapshot_marker, used to detect modifications) and the file-list
        baseline (.snapshot_files, used to detect deletions). Both live outside
        edited/ and original/ so they are never copied into the user's project."""
        return (
            f"touch {self._project_dir}/.snapshot_marker && "
            f"cd {self._project_dir}/edited && "
            f"{self._list_tracked_files_cmd()} > {self._project_dir}/.snapshot_files"
        )

    async def _capture_iter_snapshot(self):
        """Snapshot the tracked-file list at the START of this iteration so the
        created/deleted notices reflect THIS turn's net change. Distinct from the
        session .snapshot_files, which stays fixed for save-time deletions."""
        pd = self._project_dir
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c",
             f"cd {pd}/edited && {self._list_tracked_files_cmd()} > {pd}/.iter_snapshot_files"],
            user="agent",
        )

    async def _announce_file_events(self):
        """Emit informational chat notices for files created/deleted this
        iteration (net vs the per-iteration snapshot). Edited existing files are
        in both lists, so they produce no notice (they get diff boxes instead)."""
        pd = self._project_dir
        script = (
            f"cd {pd}/edited && "
            f"{self._list_tracked_files_cmd()} > {pd}/.iter_current_files; "
            "echo __CREATED__; "
            f"LC_ALL=C comm -13 {pd}/.iter_snapshot_files {pd}/.iter_current_files; "
            "echo __DELETED__; "
            f"LC_ALL=C comm -23 {pd}/.iter_snapshot_files {pd}/.iter_current_files; "
            f"rm -f {pd}/.iter_current_files"
        )
        _, output = await asyncio.to_thread(
            self._container.exec_run, ["sh", "-c", script], user="agent",
        )
        created, deleted = self._parse_file_events(decode_output(output))
        for path in created:
            await self._try_send({"type": "file_event", "data": {"action": "created", "path": path}})
        for path in deleted:
            await self._try_send({"type": "file_event", "data": {"action": "deleted", "path": path}})

    @staticmethod
    def _parse_file_events(text: str) -> tuple[list[str], list[str]]:
        created: list[str] = []
        deleted: list[str] = []
        bucket: list[str] | None = None
        for raw in text.splitlines():
            line = raw.strip()
            if line == "__CREATED__":
                bucket = created
            elif line == "__DELETED__":
                bucket = deleted
            elif bucket is not None and line:
                bucket.append(line[2:] if line.startswith("./") else line)
        return created, deleted

    async def _extract_changes(self) -> bool:
        """Promote files modified/created since the snapshot into original/ and
        recompute .deletions, then report whether anything changed this pass.

        Filesystem-based and tool-agnostic: it captures Write / rm / mv / shell
        operations as well as Edits. Returns True iff at least one file was
        promoted or recorded as deleted — the caller uses this to drive the
        session change state (which gates the Save / exit-unsaved warning)."""
        pd = self._project_dir
        prunes = self._find_prunes()
        script = (
            f"cd {pd}/edited && "
            # Promote files modified/created since the snapshot marker.
            f"find . -mindepth 1 \\( {prunes} \\) -prune -o "
            f"-newer {pd}/.snapshot_marker -type f -print > {pd}/.changed_files; "
            "while IFS= read -r f; do "
            f"  mkdir -p \"{pd}/original/$(dirname \"$f\")\"; "
            f"  cp \"$f\" \"{pd}/original/$f\"; "
            f"done < {pd}/.changed_files; "
            # Recompute deletions against the fixed snapshot baseline and
            # overwrite .deletions each iteration (never append): a file deleted
            # then recreated correctly drops back out. The .changed_files /
            # .current_files scratch lists and .deletions all live outside
            # edited/ and original/, so neither the scan nor `cp -a original/.`
            # ever sees them.
            f"{self._list_tracked_files_cmd()} > {pd}/.current_files && "
            f"LC_ALL=C comm -23 {pd}/.snapshot_files {pd}/.current_files > {pd}/.deletions; "
            f"promoted=$(wc -l < {pd}/.changed_files | tr -dc 0-9); "
            f"deleted=$(wc -l < {pd}/.deletions | tr -dc 0-9); "
            f"rm -f {pd}/.changed_files {pd}/.current_files; "
            'echo "EXTRACT_RESULT promoted=${promoted:-0} deleted=${deleted:-0}"'
        )
        _, output = await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", script],
            user="agent",
        )
        promoted = deleted = 0
        for line in decode_output(output).splitlines():
            if line.startswith("EXTRACT_RESULT"):
                for tok in line.split():
                    if tok.startswith("promoted="):
                        promoted = int(tok.split("=", 1)[1] or 0)
                    elif tok.startswith("deleted="):
                        deleted = int(tok.split("=", 1)[1] or 0)
        changed = promoted > 0 or deleted > 0
        logger.info(
            "Extracted changes: %d promoted, %d deleted (changed=%s)",
            promoted, deleted, changed,
        )
        return changed

    async def _peek_daemon(self) -> dict | None:
        ec, output = await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "printf '{\"action\":\"peek\"}' | "
                "socat -t5 - UNIX-CONNECT:/workspace/work/hook.sock 2>/dev/null",
            ],
            user="agent",
        )
        if ec != 0:
            return None
        try:
            return json.loads(decode_output(output))
        except json.JSONDecodeError:
            return None

    async def _emit_pending_diffs(self) -> bool:
        """Peek the daemon and (re)send diff previews for changed files. Returns
        True if the peek succeeded (so callers can retry on transient failure)."""
        state = await self._peek_daemon()
        if state is None:
            return False
        for f in state.get("files", []):
            file_path = f.get("file_path", "")
            hunks = f.get("hunks", [])
            rev = f.get("rev", 0)
            backup = f.get("backup")
            if not file_path or not hunks:
                continue
            if not self._diffs.reconcile(file_path, rev, backup):
                continue
            hunks = sorted(hunks, key=self._hunk_sort_key)
            hunks = self._merge_overlapping_hunks(hunks)
            await self._try_send({
                "type": "diff_preview",
                "data": {
                    "diff_id": diff_id_for(file_path),
                    "file_path": file_path,
                    "hunks": hunks,
                    "rev": rev,
                },
            })
        return True

    async def _poll_diffs(self):
        while not self._cancelled:
            try:
                await self._emit_pending_diffs()
            except Exception as e:
                logger.debug("diff poll error: %s", e)
            await asyncio.sleep(DIFF_POLL_INTERVAL_SECONDS)

    async def _run_builder(self):
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

    async def teardown(self, discard: bool = False):
        """Fully tear down the agent session: stop the agent + daemon and clear
        the ephemeral work/ directory. When discard is set, also delete this
        project's codebase directory. Other projects are always left untouched."""
        self.cancel()
        if not self._container:
            return
        await asyncio.sleep(0.3)
        # Always clear the ephemeral work/ socket + backups; on discard also delete
        # this project's codebase directory (other projects are left untouched).
        targets = "/workspace/work/* /workspace/work/.[!.]* /workspace/work/..?*"
        if discard:
            targets = f"{self._project_dir} {targets}"
        try:
            await asyncio.to_thread(
                self._container.exec_run,
                ["sh", "-c", f"rm -rf {targets} 2>/dev/null || true"],
                user="agent",
            )
        except Exception as e:
            logger.error("Teardown error for %s: %s", self.project_id, e)

    def _project_dir_exists(self) -> bool:
        if self.context.project_type == "github":
            check = f"test -d {self._project_dir}/.git"
        else:
            check = (
                f"test -d {self._project_dir}/edited && "
                f"[ -n \"$(ls -A {self._project_dir}/edited 2>/dev/null)\" ]"
            )
        exit_code, _ = self._container.exec_run(["sh", "-c", check], user="agent")
        return exit_code == 0

    def _copy_codebase_to_volume(self) -> tuple[bool, str]:
        try:
            if self._project_dir_exists():
                logger.info("Reusing existing codebase for project %s (resuming prior edits)", self.project_id)
                return (True, "")
            if self.context.project_type == "github":
                return self._clone_github_repo()
            return self._copy_local_codebase()
        except Exception as e:
            return (False, str(e))

    def _copy_local_codebase(self) -> tuple[bool, str]:
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
             f"rm -rf {self._project_dir} 2>/dev/null || true; "
             f"mkdir -p {self._project_dir}/edited {self._project_dir}/original; "
             "chown -R agent:agent /workspace"],
            user="root",
        )

        copy_ctr = get_docker_client().containers.run(
            "alpine",
            command=["sh", "-c", f"cp -a /src/. /vol/codebase/{pid}/edited/ && echo Success || echo Failed"],
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

    def _clone_github_repo(self) -> tuple[bool, str]:
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
                ["sh", "-c", f"rm -rf {self._project_dir} 2>/dev/null || true; mkdir -p {self._project_dir}; chown -R agent:agent /workspace"],
                user="root",
            )

            branch_name = f"deplai/customize-{self.project_id}"

            clone_script = (
                f"git clone {clone_url} /repo/codebase/{self.project_id} && "
                f"cd /repo/codebase/{self.project_id} && "
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
            logger.info("GitHub repo cloned into volume for project %s", self.project_id)
            return (True, "")
        except Exception as e:
            logger.error("Failed to clone GitHub repo: %s", e)
            return (False, str(e))
