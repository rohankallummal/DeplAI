import asyncio
import base64
import json
import logging
import os
import queue as thread_queue

from fastapi import WebSocket

from models import ScanContext
from runner_base import RunnerBase
from utils import (
    get_docker_client,
    get_or_create_remediation_container,
    clear_agent_artifacts,
    decode_output,
    REMEDIATION_CONTAINER_NAME,
)

logger = logging.getLogger(__name__)

TOTAL_STEPS = 12
MCP_HEARTBEAT_INTERVAL = 120.0

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
        self._mcp_heartbeat_task: asyncio.Task | None = None

    def cancel(self):
        super().cancel()
        if self._mcp_heartbeat_task and not self._mcp_heartbeat_task.done():
            self._mcp_heartbeat_task.cancel()
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

        firecrawl_key = os.environ.get("FIRECRAWL_API_KEY", "")
        mcp_settings: dict = {"ackTos": True}
        if firecrawl_key:
            mcp_settings["mcpServers"] = {
                "firecrawl": {"url": f"https://mcp.firecrawl.dev/{firecrawl_key}/v2/mcp"},
            }
        settings_b64 = base64.b64encode(json.dumps(mcp_settings).encode()).decode()
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", f"mkdir -p /home/agent/.claude && echo {settings_b64} | base64 -d > /home/agent/.claude/settings.json && chown -R agent:agent /home/agent/.claude"],
            user="root",
        )

        exit_code, diag_output = await asyncio.to_thread(
            self._container.exec_run,
            ["claude", "--version"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        diag_text = decode_output(diag_output).strip()
        if exit_code != 0:
            return await self._terminate(f"Claude CLI check failed (exit {exit_code}): {diag_text}")
        await self._send_message("debug", f"Claude CLI ready ({diag_text})")

        if firecrawl_key:
            mcp_ok = await self._check_mcp_connectivity()
            if not mcp_ok:
                await self._send_message(
                    "warning",
                    "Firecrawl MCP health check failed — web research will be unavailable during remediation",
                )
            else:
                self._mcp_heartbeat_task = asyncio.create_task(self._heartbeat_mcp())
        else:
            await self._send_message(
                "warning",
                "FIRECRAWL_API_KEY not set — web research will be unavailable during remediation",
            )

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

        if self._mcp_heartbeat_task and not self._mcp_heartbeat_task.done():
            self._mcp_heartbeat_task.cancel()

        return True

    async def _heartbeat_mcp(self, interval: float = MCP_HEARTBEAT_INTERVAL):
        try:
            while not self._cancelled:
                await asyncio.sleep(interval)
                if self._cancelled:
                    return
                ok = await self._check_mcp_connectivity()
                if ok:
                    logger.debug("Firecrawl MCP heartbeat ok")
                else:
                    logger.warning("Firecrawl MCP heartbeat failed")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("MCP heartbeat crashed: %s", e, exc_info=True)

    async def _check_mcp_connectivity(self) -> bool:
        firecrawl_key = os.environ.get("FIRECRAWL_API_KEY", "")
        if not firecrawl_key:
            return False
        mcp_url = f"https://mcp.firecrawl.dev/{firecrawl_key}/v2/mcp"
        try:
            exit_code, output = await asyncio.to_thread(
                self._container.exec_run,
                [
                    "sh", "-c",
                    "curl -s --max-time 10 --connect-timeout 5 "
                    '-H "Content-Type: application/json" '
                    '-H "Accept: application/json, text/event-stream" '
                    '-d \'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1.0.0"}}}\' '
                    f'"{mcp_url}"',
                ],
                user="agent",
            )
            text = decode_output(output).strip()
            if exit_code == 0 and "serverInfo" in text:
                logger.info("Firecrawl MCP server is available")
                return True
            logger.warning(f"Firecrawl MCP health check failed (exit {exit_code}): {text[:200]}")
            return False
        except Exception as e:
            logger.warning(f"MCP health check failed: {e}")
            return False
