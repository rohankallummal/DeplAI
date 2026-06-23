import asyncio
import json
import logging
import queue as thread_queue
import shlex
from typing import Callable

from fastapi import WebSocket

from models import StreamStatus, CustomizeMessage

logger = logging.getLogger(__name__)


class CancelledError(Exception):
    pass


async def stream_container_exec(
    container,
    cmd: list[str],
    *,
    workdir: str,
    user: str,
    environment: dict,
    is_cancelled: Callable[[], bool],
    on_message: Callable[[dict], None],
) -> None:
    """Run `cmd` in `container` (stream=True) and invoke on_message(dict) for each
    line of stdout parsed as a JSON pipeline message. Non-JSON lines surface as
    {"type":"error","content":<line>}. Returns when the stream ends or the caller
    reports cancellation. Shared by every container-exec agent phase."""
    msg_q: thread_queue.Queue = thread_queue.Queue()

    def _enqueue_line(text: str):
        text = text.strip()
        if not text:
            return
        try:
            msg_q.put(json.loads(text))
        except json.JSONDecodeError:
            msg_q.put({"type": "error", "content": text})

    def _read_exec_output():
        buffer = ""
        try:
            # shlex.quote each arg: user request / project name may contain quotes
            # or shell metacharacters. Naive '%s' wrapping is a shell-injection
            # vector; shlex.quote is POSIX-sh safe.
            wrapped_cmd = ["sh", "-c", " ".join(shlex.quote(c) for c in cmd) + " 2>&1"]
            _, output = container.exec_run(
                wrapped_cmd, stream=True, workdir=workdir, user=user,
                environment=environment,
            )
            for chunk in output:
                buffer += chunk.decode(errors="replace")
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    _enqueue_line(line)
            _enqueue_line(buffer)
        except Exception as e:
            logger.debug("Exec stream ended: %s", e)
        finally:
            msg_q.put(None)

    asyncio.get_running_loop().run_in_executor(None, _read_exec_output)

    while True:
        msg = await asyncio.to_thread(msg_q.get)
        if msg is None:
            break
        if is_cancelled():
            break
        on_message(msg)


class RunnerBase:

    def __init__(self, websocket: WebSocket, total_steps: int):
        self.websocket: WebSocket | None = websocket
        self._cancelled = False
        self._message_index = 0
        self._total_steps = total_steps
        self.status: str = "idle"

    def cancel(self):
        self._cancelled = True

    def detach(self):
        self.websocket = None

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
        message = CustomizeMessage(index=self._message_index, total=self._total_steps, type=msg_type, content=content)
        payload = {"type": "message", "data": message.model_dump()}
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
