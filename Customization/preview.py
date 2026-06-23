import asyncio
import json
import logging
import os
import shlex

from fastapi import WebSocket

from models import PreviewValidationRequest, PreviewStatus
from runner_base import RunnerBase, CancelledError, stream_container_exec
from preview_gateway import ensure_gateway, configure_gateway, wait_until_serving
from utils import (
    get_docker_client,
    decode_output,
    local_project_host_path,
    run_and_cleanup,
    PREVIEW_IMAGE,
    PREVIEW_CONTAINER_NAME,
    PREVIEW_CODE_VOLUME,
    PREVIEW_NETWORK,
    PREVIEW_HOST_PORT,
    remove_preview_container,
    remove_preview_gateway,
    remove_preview_volume,
)

logger = logging.getLogger(__name__)

CODE_DIR = "/workspace/code"
STATUS_PATH = "/workspace/preview/status.json"
STATUS_POLL_SECONDS = 1.0


class PreviewRunner(RunnerBase):
    """Orchestrates a single Live Preview: builds the volume, preview container,
    and nginx gateway; runs the previewer agent inside the preview container;
    reads the agent-reported port; points the gateway at it; streams status."""

    def __init__(self, websocket: WebSocket, project_id: str, context: PreviewValidationRequest):
        super().__init__(websocket, total_steps=1)
        self.project_id = project_id
        self.context = context
        self._container = None

    # ---- status helpers -----------------------------------------------------

    async def _send_preview_status(self, status: str):
        self.status = status
        await self._try_send({"type": "status", "status": status})

    async def _send_progress(self, message: str):
        await self._try_send({"type": "progress", "data": {"message": message}})

    # ---- lifecycle ----------------------------------------------------------

    async def _run_pipeline(self) -> bool:
        await self._send_preview_status(PreviewStatus.preparing.value)
        # Any unexpected failure in orchestration (e.g. a Docker error standing up
        # the container or gateway) must surface to the user as an error frame,
        # not escape as an unhandled exception that leaves the panel spinning.
        try:
            return await self._orchestrate()
        except CancelledError:
            raise
        except Exception:
            logger.error("Preview pipeline failed for %s", self.project_id, exc_info=True)
            return await self._fail("Could not start the preview. Please try again.")

    async def _orchestrate(self) -> bool:
        # Single concurrent preview: tear down anything left from a prior session
        # before standing up fresh resources.
        await asyncio.to_thread(self._teardown_resources)
        self._check_cancelled()

        await asyncio.to_thread(self._create_volume)

        await self._send_progress("Preparing your project")
        ok, err = await asyncio.to_thread(self._populate_code)
        if not ok:
            logger.error("Preview code population failed: %s", err)
            return await self._fail("Could not load your project for preview. Please try again.")
        self._check_cancelled()

        ok, err = await asyncio.to_thread(self._create_container)
        if not ok:
            logger.error("Preview container create failed: %s", err)
            return await self._fail("Could not start the preview environment. Please try again.")
        self._check_cancelled()

        await asyncio.to_thread(ensure_gateway)
        self._check_cancelled()

        # Run the previewer agent while a poller streams installing/starting from
        # the status file it writes.
        poller = asyncio.create_task(self._poll_status())
        try:
            await self._run_preview_agent()
        finally:
            poller.cancel()
            try:
                await poller
            except asyncio.CancelledError:
                pass

        self._check_cancelled()
        # status.json is the source of truth for readiness: the dev server is
        # launched detached and outlives the agent, so the agent merely exiting is
        # not "ready" — we read the port + terminal state it recorded.
        status = await asyncio.to_thread(self._read_status)
        return await self._finish(status)

    async def _finish(self, status: dict | None) -> bool:
        # A concurrent user-initiated stop() removed the container out from under
        # the run; don't emit a spurious "no result" error for that.
        if self._cancelled:
            return False

        if not status:
            return await self._fail(
                "The preview agent did not report a result. Check that the project "
                "is a supported Node/JS web app."
            )

        state = status.get("status")
        message = status.get("message") or ""
        port = status.get("port")

        if state == "ready" and isinstance(port, int):
            if not await asyncio.to_thread(configure_gateway, port):
                return await self._fail("Could not route the preview. Please try again.")
            # nginx -s reload is async; wait until the gateway actually serves the
            # upstream before signaling ready, so the iframe never loads the
            # holding page during the reload window. If it never becomes
            # reachable, surface an error rather than a broken preview.
            if not await asyncio.to_thread(wait_until_serving):
                return await self._fail(
                    "The preview did not become reachable in time. Please try again."
                )
            await self._send_preview_status(PreviewStatus.ready.value)
            await self._try_send({
                "type": "ready",
                "data": {"url": f"http://localhost:{PREVIEW_HOST_PORT}"},
            })
            logger.info("Preview ready for %s on port %s", self.project_id, port)
            return True

        # Terminal error reported by the agent (launch / app / unsupported).
        await self._try_send({
            "type": "error",
            "data": message or "The preview could not be started.",
            "category": status.get("category"),
        })
        await self._send_preview_status(PreviewStatus.error.value)
        return False

    async def _fail(self, message: str) -> bool:
        await self._try_send({"type": "error", "data": message})
        await self._send_preview_status(PreviewStatus.error.value)
        return False

    async def stop(self):
        """Tear down the whole preview: dev server, container, gateway, volume."""
        self.cancel()
        await asyncio.to_thread(self._teardown_resources)

    def _teardown_resources(self):
        remove_preview_container()
        remove_preview_gateway()
        ok, err = remove_preview_volume()
        if not ok:
            logger.warning("Preview volume removal failed: %s", err)
        # The container is gone; drop the handle so any in-flight exec recognizes
        # the torn-down state instead of calling a stale, removed container.
        self._container = None

    # ---- volume + code ------------------------------------------------------

    def _create_volume(self):
        try:
            get_docker_client().volumes.create(name=PREVIEW_CODE_VOLUME)
        except Exception:
            pass

    def _populate_code(self) -> tuple[bool, str]:
        try:
            if self.context.project_type == "github":
                return self._clone_repo()
            return self._copy_local_code()
        except Exception as e:
            return (False, str(e))

    def _copy_local_code(self) -> tuple[bool, str]:
        host_path, check_path = local_project_host_path(self.context.user_id, self.project_id)
        if not os.path.isdir(check_path):
            return (False, f"Project directory not found at {check_path}")

        _, logs = run_and_cleanup(
            image="alpine",
            command=["sh", "-c", "rm -rf /vol/code && mkdir -p /vol/code && cp -a /src/. /vol/code/ && echo Success || echo Failed"],
            volumes={
                PREVIEW_CODE_VOLUME: {"bind": "/vol", "mode": "rw"},
                host_path: {"bind": "/src", "mode": "ro"},
            },
        )
        if "Success" in logs:
            return (True, "")
        return (False, f"Copy failed: {logs}")

    def _clone_repo(self) -> tuple[bool, str]:
        token = self.context.github_token
        repo_url = self.context.repository_url
        if not repo_url or not token:
            return (False, "Missing repository URL or GitHub token")

        clone_url = repo_url.replace(
            "https://github.com/", f"https://x-access-token:{token}@github.com/"
        )
        if not clone_url.endswith(".git"):
            clone_url += ".git"

        branch = self.context.branch
        branch_arg = f"--branch {shlex.quote(branch)} " if branch else ""
        script = (
            "rm -rf /repo/code && "
            f"git clone --depth 1 {branch_arg}{shlex.quote(clone_url)} /repo/code "
            "&& echo Success || echo Failed"
        )

        _, logs = run_and_cleanup(
            image="alpine/git",
            entrypoint="sh",
            command=["-c", script],
            volumes={PREVIEW_CODE_VOLUME: {"bind": "/repo", "mode": "rw"}},
            tmpfs={"/git": ""},
        )
        if "Success" in logs:
            return (True, "")
        return (False, f"Clone failed: {logs}")

    # ---- preview container --------------------------------------------------

    def _create_container(self) -> tuple[bool, str]:
        try:
            client = get_docker_client()
            self._container = client.containers.run(
                PREVIEW_IMAGE,
                command=["sleep", "infinity"],
                name=PREVIEW_CONTAINER_NAME,
                user="agent",
                volumes={PREVIEW_CODE_VOLUME: {"bind": "/workspace", "mode": "rw"}},
                environment={
                    "HOME": "/home/agent",
                    "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
                },
                network=PREVIEW_NETWORK,
                detach=True,
            )
            # The volume's /code was written by root (alpine cp/clone); hand the
            # whole workspace to the agent user so installs and writes succeed.
            self._container.exec_run(
                ["sh", "-c", "mkdir -p /workspace/preview && chown -R agent:agent /workspace"],
                user="root",
            )
            return (True, "")
        except Exception as e:
            return (False, str(e))

    # ---- agent --------------------------------------------------------------

    def _read_status(self) -> dict | None:
        if not self._container:
            return None
        try:
            ec, out = self._container.exec_run(["cat", STATUS_PATH], user="agent")
        except Exception:
            return None
        if ec != 0:
            return None
        try:
            return json.loads(decode_output(out))
        except json.JSONDecodeError:
            return None

    async def _poll_status(self):
        last = None
        while not self._cancelled:
            st = await asyncio.to_thread(self._read_status)
            if st:
                s = st.get("status")
                if s and s != last and s in ("installing", "starting"):
                    last = s
                    await self._send_preview_status(s)
                    msg = st.get("message")
                    if msg:
                        await self._send_progress(msg)
            await asyncio.sleep(STATUS_POLL_SECONDS)

    async def _run_preview_agent(self):
        cmd = [
            "python", "-m", "pipeline",
            "--phase", "preview",
            "--project-name", self.context.project_name,
            "--project-id", self.project_id,
            "--codebase-path", CODE_DIR,
        ]
        environment = {
            "HOME": "/home/agent",
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "USER": "agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        }

        def on_message(msg: dict):
            # Readiness comes from status.json (read after the agent exits), not the
            # agent's result message, so here we only echo progress lines to logs.
            if msg.get("type") == "result":
                return
            content = msg.get("content", "")
            if content:
                logger.info("[PREVIEW] %s", content)

        await stream_container_exec(
            self._container, cmd, workdir="/app", user="agent",
            environment=environment, is_cancelled=lambda: self._cancelled,
            on_message=on_message,
        )
