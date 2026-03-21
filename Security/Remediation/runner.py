import asyncio
import json
import logging
import queue as thread_queue

from fastapi import WebSocket

from models import ScanContext
from runner_base import RunnerBase
from utils import (
    get_docker_client,
    get_or_create_remediation_container,
    clear_agent_artifacts,
    REMEDIATION_CONTAINER_NAME,
)

logger = logging.getLogger(__name__)

TOTAL_STEPS = 12

_last_project_id: str | None = None


def reset_last_project() -> None:
    global _last_project_id
    _last_project_id = None


class RemediationRunner(RunnerBase):

    def __init__(self, websocket: WebSocket, project_id: str, context: ScanContext):
        super().__init__(websocket, TOTAL_STEPS)
        self.project_id = project_id
        self.context = context
        self._container = None
        self.remediation_result: dict | None = None

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

    async def _run_pipeline(self) -> bool:
        global _last_project_id

        if _last_project_id is not None and _last_project_id != self.project_id:
            await self._send_message("info", "New project — resetting agent container")
            await asyncio.to_thread(clear_agent_artifacts)
            try:
                c = get_docker_client().containers.get(REMEDIATION_CONTAINER_NAME)
                c.restart(timeout=5)
            except Exception:
                pass

        _last_project_id = self.project_id

        await self._send_message("debug", "Preparing remediation container")
        self._container = await asyncio.to_thread(get_or_create_remediation_container)
        self._check_cancelled()

        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "chmod 666 /var/run/docker.sock 2>/dev/null; "
                "chown -R agent:agent /workspace /codebase /home/agent 2>/dev/null; "
                "chmod -R a+r /security_reports 2>/dev/null; "
                "chmod -R a+r /app 2>/dev/null",
            ],
            user="root",
        )

        exit_code, diag_output = await asyncio.to_thread(
            self._container.exec_run,
            ["claude", "--version"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        diag_text = diag_output.decode(errors="replace").strip() if isinstance(diag_output, bytes) else str(diag_output)
        if exit_code != 0:
            return await self._terminate(f"Claude CLI check failed (exit {exit_code}): {diag_text}")
        await self._send_message("debug", f"Claude CLI ready ({diag_text})")

        await self._send_message("debug", "Starting remediation pipeline")

        cmd = [
            "python", "-m", "Remediation.pipeline",
            "--project-name", self.context.project_name,
            "--project-id", self.project_id,
        ]

        msg_q: thread_queue.Queue = thread_queue.Queue()

        def _read_exec_output():
            try:
                _, output = self._container.exec_run(
                    cmd, stream=True, workdir="/app", user="agent",
                    environment={"HOME": "/home/agent"},
                )
                for chunk in output:
                    for line in chunk.decode(errors="replace").splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            msg_q.put(json.loads(line))
                        except json.JSONDecodeError:
                            msg_q.put({"type": "error", "content": line})
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
                await self._send_message(
                    msg.get("type", "info"),
                    msg.get("content", ""),
                )

        self.remediation_result = result
        if result:
            await self._send_result(result)

        return True
