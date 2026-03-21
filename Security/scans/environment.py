import asyncio
import os
from fastapi import WebSocket

from models import ScanContext, StreamStatus
from runner_base import RunnerBase
from .bearer import run_bearer_scan
from .sbom import run_syft_scan, run_grype_scan
from utils import get_docker_client, decode_output, SCAN_VOLUME_NAMES, CODEBASE_VOLUME

TOTAL_STEPS = 10


class EnvironmentInitializer(RunnerBase):
    def __init__(self, websocket: WebSocket, scan_context: ScanContext):
        super().__init__(websocket, TOTAL_STEPS)
        self.scan_context = scan_context
        self._docker = get_docker_client()

    def _check_docker_running(self) -> bool:
        try:
            self._docker.ping()
            return True
        except Exception:
            return False

    def _check_volumes_exist(self) -> bool:
        try:
            for name in SCAN_VOLUME_NAMES:
                self._docker.volumes.get(name)
            return True
        except Exception:
            return False

    def _create_volumes(self) -> tuple[bool, str]:
        try:
            for name in SCAN_VOLUME_NAMES:
                self._docker.volumes.create(name=name)
            return (True, "")
        except Exception as e:
            return (False, str(e))

    def _clear_codebase_volume(self) -> tuple[bool, str]:
        try:
            self._docker.containers.run(
                "alpine",
                command=["sh", "-c", "rm -rf /vol/* /vol/.[!.]* /vol/..?*"],
                volumes={CODEBASE_VOLUME: {"bind": "/vol", "mode": "rw"}},
                remove=True,
            )
            return (True, "")
        except Exception as e:
            return (False, str(e))

    def _ingest_github_repo(self) -> tuple[bool, str]:
        try:
            token = self.scan_context.github_token
            repo_url = self.scan_context.repository_url

            if not repo_url or not token:
                return (False, "Missing repository URL or GitHub token")

            clone_url = repo_url.replace(
                "https://github.com/",
                f"https://x-access-token:{token}@github.com/",
            )
            if not clone_url.endswith(".git"):
                clone_url += ".git"

            self._docker.containers.run(
                "alpine/git",
                command=["clone", clone_url, "/repo"],
                volumes={CODEBASE_VOLUME: {"bind": "/repo", "mode": "rw"}},
                tmpfs={"/git": ""},
                remove=True,
            )
            return (True, "")
        except Exception as e:
            return (False, str(e))

    def _ingest_local_project(self) -> tuple[bool, str]:
        try:
            user_id = self.scan_context.user_id
            project_id = self.scan_context.project_id

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
                return (False, f"Local project directory not found at {check_path}")

            output = self._docker.containers.run(
                "alpine",
                command=["sh", "-c", "cp -a /src/. /repo/ && echo Success || echo Failed"],
                volumes={
                    CODEBASE_VOLUME: {"bind": "/repo", "mode": "rw"},
                    host_path: {"bind": "/src", "mode": "ro"},
                },
                remove=True,
            )
            decoded = decode_output(output)
            if "Success" in decoded:
                return (True, "")
            return (False, f"Copy failed: {decoded}")
        except Exception as e:
            return (False, str(e))

    async def _run_pipeline(self) -> bool:
        self._check_cancelled()
        await self._send_message("phase", "Initializing Scan")

        docker_ok = await self._run_step(self._check_docker_running)
        if not docker_ok:
            return await self._terminate(
                "Docker Engine is not running. Please start Docker Desktop and try again."
            )

        already_exist = await self._run_step(self._check_volumes_exist)

        if already_exist:
            await self._send_message("success", "Setup already available. Skipping initialization and proceeding.")

            success, error_msg = await self._run_step(self._clear_codebase_volume)
            if not success:
                return await self._terminate(f"Error: Terminating workflow — {error_msg}")
            await self._send_message("info", "Clearing out old content")
        else:
            success, error_msg = await self._run_step(self._create_volumes)
            if not success:
                return await self._terminate(f"Error: Terminating workflow — {error_msg}")
            await self._send_message("info", "Docker volumes created successfully")

        await self._send_message("success", "Setup is ready")

        ingest = self._ingest_github_repo if self.scan_context.project_type == "github" else self._ingest_local_project
        success, error_msg = await self._run_step(ingest)
        if not success:
            return await self._terminate(f"Error: Terminating workflow — {error_msg}")
        await self._send_message("success", "Project successfully copied to volume.")

        self._check_cancelled()
        await self._send_message("phase", "Executing security tools")

        p_name = self.scan_context.project_name
        p_id = self.scan_context.project_id

        async def bearer_branch() -> tuple[bool, str, str]:
            success, error_msg = await self._run_step(
                lambda: run_bearer_scan(p_name, p_id)
            )
            return (success, error_msg, "Bearer")

        async def sbom_branch() -> tuple[bool, str, str]:
            success, error_msg = await self._run_step(
                lambda: run_syft_scan(p_name, p_id)
            )
            if not success:
                return (False, error_msg, "Syft")
            success, error_msg = await self._run_step(
                lambda: run_grype_scan(p_name, p_id)
            )
            return (success, error_msg, "Syft+Grype")

        results = await asyncio.gather(bearer_branch(), sbom_branch())

        for success, error_msg, tool_name in results:
            if success:
                await self._send_message("success", f"{tool_name} scan completed successfully")
            else:
                await self._send_message("error", f"{tool_name} scan failed: {error_msg}")

        if not all(success for success, _, _ in results):
            await self._send_status(StreamStatus.error)
            return False

        return True
