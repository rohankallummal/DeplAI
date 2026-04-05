import asyncio
import logging
from collections import deque

from fastapi import WebSocket

from models import StreamStatus, DeployMessage

logger = logging.getLogger(__name__)

MAX_RECENT_MESSAGES = 50


class CancelledError(Exception):
    pass


class RunnerBase:

    def __init__(self, websocket: WebSocket, total_steps: int):
        self.websocket: WebSocket | None = websocket
        self._cancelled = False
        self._message_index = 0
        self._total_steps = total_steps
        self.status: str = "idle"
        self.recent_messages: deque[dict] = deque(maxlen=MAX_RECENT_MESSAGES)

    def cancel(self):
        self._cancelled = True

    def detach(self):
        self.websocket = None

    async def attach(self, websocket: WebSocket):
        self.websocket = websocket
        for msg in self.recent_messages:
            try:
                await websocket.send_json(msg)
            except Exception:
                break
        try:
            await websocket.send_json({
                "type": "status",
                "status": self.status,
            })
        except Exception:
            pass

    def _check_cancelled(self):
        if self._cancelled:
            raise CancelledError()

    async def _try_send(self, payload: dict):
        if self.websocket is not None:
            try:
                await self.websocket.send_json(payload)
            except Exception:
                self.websocket = None

    async def _send_message(self, msg_type: str, content: str):
        self._message_index += 1
        message = DeployMessage(index=self._message_index, total=self._total_steps, type=msg_type, content=content)
        payload = {"type": "message", "data": message.model_dump()}
        self.recent_messages.append(payload)
        await self._try_send(payload)

    async def _send_status(self, status: StreamStatus):
        self.status = status.value
        await self._try_send({"type": "status", "status": status.value})

    async def _send_result(self, data: dict):
        await self._try_send({"type": "result", "data": data})

    async def _terminate(self, message: str) -> bool:
        await self._send_message("error", message)
        await self._send_status(StreamStatus.error)
        return False

    async def run(self) -> bool:
        self.status = "running"
        try:
            result = await self._run_pipeline()
            self.status = "completed" if result else "error"
            return result
        except CancelledError:
            self.status = "error"
            return False

    async def _run_pipeline(self) -> bool:
        raise NotImplementedError
