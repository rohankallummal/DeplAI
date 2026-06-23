import asyncio
import json
import logging
import os
import shlex

from fastapi import WebSocket

from models import CustomizeValidationRequest, StreamStatus
from runner_base import RunnerBase, CancelledError, stream_container_exec
from utils import (
    get_docker_client,
    get_or_create_customize_container,
    CUSTOMIZE_CODE_VOLUME,
    decode_output,
    local_project_host_path,
)
from publish import save_local_changes, create_customize_pr
from constants import legacy_stream_branch

logger = logging.getLogger(__name__)

TOTAL_STEPS = 8
DIFF_POLL_INTERVAL_SECONDS = 0.7
HOOK_SOCK = "/workspace/work/hook.sock"
FSEVENTS_SOCK = "/workspace/work/fsevents.sock"


def _socat_send(sock_path: str, payload: dict) -> str:
    """Shell snippet that sends one JSON payload to a unix socket and prints the
    response. shlex.quote keeps the payload intact in the shell."""
    body = json.dumps(payload)
    return (
        f"printf '%s' {shlex.quote(body)} | "
        f"socat -t5 - UNIX-CONNECT:{sock_path} 2>/dev/null"
    )


class CustomizationRunner(RunnerBase):

    def __init__(self, websocket: WebSocket, project_id: str, context: CustomizeValidationRequest):
        super().__init__(websocket, TOTAL_STEPS)
        self.project_id = project_id
        self.context = context
        self._container = None

        self._chat_event = asyncio.Event()
        self._chat_message: str | None = None

        self._changes_made = False

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

    def _effective_branches(self) -> tuple[str, str, bool]:
        """Resolve (customize_branch, base_branch, is_new) for this session. When the
        branch-aware fields are absent (legacy / non-popup path), fall back to the
        single-stream branch `deplai/customize-{project_id}` and the default base."""
        customize = self.context.customize_branch or legacy_stream_branch(self.project_id)
        base = self.context.base_branch or self.context.default_branch or "main"
        return customize, base, bool(self.context.is_new_branch)

    def _current_git_branch(self) -> str | None:
        """The branch currently checked out in the project's volume dir, or None."""
        ec, out = self._container.exec_run(
            ["sh", "-c", f"git -C {self._project_dir} -c safe.directory='*' rev-parse --abbrev-ref HEAD 2>/dev/null"],
            user="agent",
        )
        if ec != 0:
            return None
        return decode_output(out).strip() or None

    def cancel(self):
        super().cancel()
        # Wake any parked waits so the workflow loop observes cancellation and
        # unwinds instead of leaking a parked coroutine.
        self._chat_event.set()
        if self._container:
            try:
                self._container.exec_run(
                    ["sh", "-c", "pkill -f pipeline.py; pkill -f diff_daemon; pkill -f fs_watcher"],
                    detach=True,
                )
            except Exception:
                pass

    async def receive_chat_message(self, message: str):
        self._chat_message = message
        self._chat_event.set()

    async def receive_diff_response(self, request_id: int | None, approved: bool):
        # Forward the decision to the gate daemon, which releases the blocked
        # PreToolUse hook so the edit applies (approved) or is dropped (rejected).
        if request_id is None:
            return
        await self._daemon_request({"action": "decide", "request_id": request_id, "approved": approved})

    async def receive_grant_all(self):
        # Session-wide "apply everything": the daemon auto-approves every pending
        # and future gate, so the agent runs free while the user just watches.
        await self._daemon_request({"action": "grant_all"})

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
        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "pkill -f fs_watcher 2>/dev/null; sleep 0.2; "
                f"nohup python3 /app/hooks/fs_watcher.py {self._project_dir}/edited "
                "> /dev/null 2>&1 &",
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

            if prompt is None:
                continue

            await self._send_status(StreamStatus.executing)
            logger.info("Starting styler agent")

            if self.context.project_type == "local" and not self._cancelled:
                await self._reset_file_events()

            # Fresh gate registry for this iteration. The agent now blocks on each
            # Edit (PreToolUse gate) until the user decides, so diffs are reviewed
            # one at a time and the execute call only returns once every gate is
            # resolved — no end-of-run "awaiting decisions" wait is needed.
            await self._reset_gates()
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

            # Surface any final gate box the poller may not have emitted yet.
            try:
                await self._emit_gates()
            except Exception:
                logger.debug("final gate emit failed", exc_info=True)

            if self.context.project_type == "local" and not self._cancelled:
                try:
                    await self._drain_file_events()
                except Exception:
                    logger.debug("final file-event drain failed", exc_info=True)

            # Post-execute processing is guarded: a transient container/exec error
            # in extraction or the builder must surface as an error to the user and
            # let the session continue, not silently kill the pipeline task.
            # CancelledError (user close) propagates to unwind normally.
            try:
                self._check_cancelled()

                # The filesystem is the source of truth: approved edits applied,
                # rejected edits never did, and Write / rm / mv changes leave no
                # approval flag. Derive the change state from what extraction
                # promoted or deleted, not from per-edit decisions.
                iteration_changed = False
                if self.context.project_type == "local" and not self._cancelled:
                    if await self._extract_changes():
                        iteration_changed = True
                        self._changes_made = True

                if not execute_result or not execute_result.get("success"):
                    if iteration_changed:
                        logger.warning("Styler had errors but some changes were applied this iteration")
                    else:
                        logger.error("Styler failed; awaiting next user request")
                        await self._try_send({"type": "error", "data": "Something went wrong. Please try again."})
                        await self._send_status(StreamStatus.error)
                        continue

                if iteration_changed:
                    # Builder edits must not be gated, so flip the daemon to bypass
                    # (auto-approve) around the build phase. The execute-phase poller
                    # is already stopped, so the builder's edits surface as nothing
                    # more than file-event notices.
                    await self._set_bypass(True)
                    try:
                        await self._run_builder()
                    finally:
                        await self._set_bypass(False)
                    if self.context.project_type == "local" and not self._cancelled:
                        await self._extract_changes()
                        try:
                            await self._drain_file_events()
                        except Exception:
                            logger.debug("post-builder file-event drain failed", exc_info=True)

                await self._send_status(StreamStatus.completed)
                await self._send_result({
                    "success": True,
                    "changes_made": self._changes_made,
                })
            except CancelledError:
                raise
            except Exception:
                logger.error("Post-execute processing failed for %s", self.project_id, exc_info=True)
                await self._try_send({"type": "error", "data": "Something went wrong. Please try again."})
                await self._send_status(StreamStatus.error)
                continue

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

    async def _extract_changes(self) -> bool:
        """Promote files modified/created since the snapshot into original/, prune
        promoted files that no longer exist in edited/, and recompute .deletions,
        then report whether anything changed this pass.

        Filesystem-based and tool-agnostic: it captures Write / rm / mv / shell
        operations as well as Edits. Returns True iff at least one file was
        promoted, pruned, or recorded as deleted — the caller uses this to drive
        the session change state (which gates the Save / exit-unsaved warning)."""
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
            # Prune promoted files whose source no longer exists in edited/.
            # .deletions (below) only covers files present in the session baseline,
            # so a file created AND deleted within the same session would otherwise
            # linger in original/ and be resurrected by `cp -a original/.` at save.
            # Empty dirs left behind are removed too, so a deleted folder does not
            # reappear. .pruned lives outside edited/ and original/.
            f": > {pd}/.pruned; "
            f"if [ -d {pd}/original ]; then "
            f"( cd {pd}/original && find . -mindepth 1 \\( {prunes} \\) -prune -o -type f -print ) | "
            f"while IFS= read -r f; do "
            f"  if [ ! -e \"{pd}/edited/$f\" ]; then rm -f \"{pd}/original/$f\" && echo \"$f\" >> {pd}/.pruned; fi; "
            f"done; "
            f"find {pd}/original -mindepth 1 -type d -empty -delete 2>/dev/null || true; "
            f"fi; "
            # Recompute deletions against the fixed snapshot baseline (overwrite,
            # never append). Guard on a NON-EMPTY current listing: an empty/failed
            # scan must not make `comm -23` report every file as deleted, which
            # would mass-delete the user's project at save. .current_files is
            # removed after use; it lives outside edited/ and original/, so it is
            # neither scanned nor shipped by `cp -a original/.`.
            f"{self._list_tracked_files_cmd()} > {pd}/.current_files; "
            f"if [ -s {pd}/.current_files ]; then "
            f"LC_ALL=C comm -23 {pd}/.snapshot_files {pd}/.current_files > {pd}/.deletions; "
            f"else : > {pd}/.deletions; fi; "
            f"rm -f {pd}/.current_files; "
            f"promoted=$(wc -l < {pd}/.changed_files | tr -dc 0-9); "
            f"deleted=$(wc -l < {pd}/.deletions | tr -dc 0-9); "
            f"pruned=$(wc -l < {pd}/.pruned | tr -dc 0-9); "
            f"rm -f {pd}/.changed_files {pd}/.pruned; "
            'echo "EXTRACT_RESULT promoted=${promoted:-0} deleted=${deleted:-0} pruned=${pruned:-0}"'
        )
        ec, output = await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", script],
            user="agent",
        )
        promoted = deleted = pruned = 0
        found = False
        for line in decode_output(output).splitlines():
            if line.startswith("EXTRACT_RESULT"):
                found = True
                for tok in line.split():
                    if tok.startswith("promoted="):
                        promoted = int(tok.split("=", 1)[1] or 0)
                    elif tok.startswith("deleted="):
                        deleted = int(tok.split("=", 1)[1] or 0)
                    elif tok.startswith("pruned="):
                        pruned = int(tok.split("=", 1)[1] or 0)
        if ec != 0 or not found:
            logger.error(
                "Extraction did not complete cleanly for %s (exit=%s, parsed=%s); "
                "promoted/deleted/pruned counts may be incomplete", self.project_id, ec, found,
            )
        changed = promoted > 0 or deleted > 0 or pruned > 0
        logger.info(
            "Extracted changes: %d promoted, %d deleted, %d pruned (changed=%s)",
            promoted, deleted, pruned, changed,
        )
        return changed

    @staticmethod
    def _fs_socat(action: str) -> str:
        return _socat_send(FSEVENTS_SOCK, {"action": action})

    async def _reset_file_events(self):
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", self._fs_socat("reset")],
            user="agent",
        )

    async def _drain_file_events(self):
        """Drain buffered fs events and emit one chat notice per event, in the
        chronological order the watcher recorded them."""
        ec, output = await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", self._fs_socat("drain")],
            user="agent",
        )
        if ec != 0:
            return
        try:
            events = json.loads(decode_output(output)).get("events", [])
        except json.JSONDecodeError:
            return
        for ev in events:
            await self._try_send({
                "type": "file_event",
                "data": {
                    "action": ev.get("action"),
                    "kind": ev.get("kind", "file"),
                    "path": ev.get("path", ""),
                    "from": ev.get("from"),
                    "to": ev.get("to"),
                },
            })

    async def _daemon_request(self, payload: dict) -> dict | None:
        ec, output = await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", _socat_send(HOOK_SOCK, payload)],
            user="agent",
        )
        if ec != 0:
            return None
        try:
            return json.loads(decode_output(output))
        except json.JSONDecodeError:
            return None

    async def _reset_gates(self):
        await self._daemon_request({"action": "reset"})

    async def _set_bypass(self, on: bool):
        await self._daemon_request({"action": "bypass", "on": on})

    async def _emit_gates(self):
        """Pull newly-registered gates from the daemon and emit one diff box per
        edit (keyed by request_id). Each gate is a single hunk, so no merging or
        re-open bookkeeping is needed."""
        resp = await self._daemon_request({"action": "list_pending"})
        if not resp:
            return
        for gate in resp.get("gates", []):
            request_id = gate.get("request_id")
            file_path = gate.get("file_path", "")
            hunks = gate.get("hunks", [])
            if request_id is None or not file_path or not hunks:
                continue
            # Defense in depth: never surface a box with no actual +/- lines.
            if not any(l.get("type") in ("add", "del") for h in hunks for l in h.get("lines", [])):
                continue
            await self._try_send({
                "type": "diff_preview",
                "data": {
                    "request_id": request_id,
                    "file_path": file_path,
                    "hunks": hunks,
                    "new_file": gate.get("new_file", False),
                    "overwrite": gate.get("overwrite", False),
                    "omitted": gate.get("omitted", 0),
                },
            })

    async def _poll_diffs(self):
        while not self._cancelled:
            try:
                await self._drain_file_events()
                await self._emit_gates()
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

        environment = {
            "HOME": "/home/agent",
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "USER": "agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        }

        result: dict | None = None

        def on_message(msg: dict):
            nonlocal result
            if msg.get("type") == "result":
                result = msg.get("data")
            else:
                msg_type = msg.get("type", "info")
                msg_content = msg.get("content", "")
                if msg_type == "error":
                    logger.error(msg_content)
                else:
                    logger.info(f"[{msg_type.upper()}] {msg_content}")

        await stream_container_exec(
            self._container, cmd, workdir="/app", user="agent",
            environment=environment, is_cancelled=lambda: self._cancelled,
            on_message=on_message,
        )
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
                customize_branch, base_branch, _ = self._effective_branches()
                success, message, url = await asyncio.to_thread(
                    create_customize_pr,
                    self.project_id,
                    self.context.github_token,
                    self.context.owner,
                    self.context.repo,
                    customize_branch,
                    base_branch,
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
        # Always clear the ephemeral work/ directory (daemon sockets, fs events);
        # on discard also delete this project's codebase directory (other projects
        # are left untouched).
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
                # Branch-keyed reuse only applies to an explicit popup selection: a
                # different branch selection must re-clone so one stream never inherits
                # another's tree. The legacy single-stream path (no customize_branch)
                # and local projects resume the prior tree unconditionally — re-cloning
                # there would discard a first session's unsaved edits, since that tree
                # legitimately sits on the default branch until the first save.
                if self.context.project_type == "github" and self.context.customize_branch is not None:
                    customize_branch, _, _ = self._effective_branches()
                    current = self._current_git_branch()
                    if current == customize_branch:
                        logger.info(
                            "Reusing existing codebase for project %s (branch %s, resuming prior edits)",
                            self.project_id, customize_branch,
                        )
                        return (True, "")
                    logger.info(
                        "Existing checkout on '%s' but session targets '%s'; re-cloning",
                        current, customize_branch,
                    )
                    # fall through to a fresh clone (it rm -rf's the dir first)
                else:
                    logger.info("Reusing existing codebase for project %s (resuming prior edits)", self.project_id)
                    return (True, "")
            if self.context.project_type == "github":
                return self._clone_github_repo()
            return self._copy_local_codebase()
        except Exception as e:
            return (False, str(e))

    def _copy_local_codebase(self) -> tuple[bool, str]:
        uid, pid = self.context.user_id, self.project_id
        host_path, check_path = local_project_host_path(uid, pid)

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

            customize_branch, base_branch, is_new = self._effective_branches()
            explicit = self.context.customize_branch is not None
            repo_dir = f"/repo/codebase/{self.project_id}"

            if not explicit:
                # Legacy single-stream behavior: continue the legacy branch if it
                # exists on the remote, otherwise start from the repo's default branch.
                checkout = (
                    f"git fetch origin {customize_branch} 2>/dev/null && "
                    f"git checkout {customize_branch} 2>/dev/null || true"
                )
                strict, fail_msg = False, ""
            elif is_new:
                # Branch off the chosen base into a fresh stream branch.
                checkout = f"git checkout {base_branch} && git checkout -b {customize_branch}"
                strict, fail_msg = True, "Could not start a new customization branch"
            else:
                # Resume an existing customization branch (its open PR's head).
                checkout = f"git fetch origin {customize_branch} && git checkout {customize_branch}"
                strict, fail_msg = True, "Could not load the selected customization branch"

            clone_script = f"git clone {clone_url} {repo_dir} && cd {repo_dir} && {checkout}"

            clone_ctr = get_docker_client().containers.run(
                "alpine/git",
                entrypoint="sh",
                command=["-c", clone_script],
                volumes={CUSTOMIZE_CODE_VOLUME: {"bind": "/repo", "mode": "rw"}},
                tmpfs={"/git": ""},
                detach=True,
            )
            try:
                result = clone_ctr.wait()
                logs = decode_output(clone_ctr.logs())
            finally:
                try:
                    clone_ctr.remove(force=True)
                except Exception:
                    pass

            if strict and result.get("StatusCode", -1) != 0:
                logger.error("Clone/checkout failed for %s (%s): %s", self.project_id, customize_branch, logs)
                return (False, fail_msg)

            logger.info("GitHub repo ready for project %s on branch %s", self.project_id, customize_branch)
            return (True, "")
        except Exception as e:
            logger.error("Failed to clone GitHub repo: %s", e)
            return (False, str(e))
