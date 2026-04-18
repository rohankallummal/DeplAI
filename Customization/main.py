import asyncio
import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from models import (
    CustomizeValidationRequest,
    CustomizeValidationResponse,
    WebSocketCommand,
)
from runner import CustomizationRunner
from utils import remove_customize_container, cleanup_volumes, clear_customize_artifacts

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

API_KEY = os.environ.get("DEPLAI_SERVICE_KEY")

app = FastAPI(
    title="DEPLAI Customize",
    description="Backend API for frontend customization",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

customize_contexts: dict[str, CustomizeValidationRequest] = {}
active_customizations: dict[str, CustomizationRunner] = {}
_last_project_id: str | None = None

ACTIVE_STATUSES = frozenset({"running", "executing", "waiting_diff", "building", "build_fixing", "saving"})


async def verify_api_key(x_api_key: str = Header(None)):
    if API_KEY is None:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.post("/api/customize/validate", response_model=CustomizeValidationResponse, dependencies=[Depends(verify_api_key)])
async def validate_customize(request: CustomizeValidationRequest):
    old_runner = active_customizations.pop(request.project_id, None)
    if old_runner:
        old_runner.cancel()

    customize_contexts[request.project_id] = request
    logger.info("Customize context stored for project %s (%s)", request.project_id, request.project_name)
    return CustomizeValidationResponse(success=True, message="Customize context stored")


@app.websocket("/ws/customize/{project_id}")
async def websocket_customize(websocket: WebSocket, project_id: str, token: str = ""):
    if API_KEY and token != API_KEY:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    logger.info("WebSocket connected for project %s", project_id)

    local_runner: CustomizationRunner | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            cmd = WebSocketCommand.model_validate_json(raw)

            if cmd.action == "start":
                runner = active_customizations.get(project_id)
                if runner and runner.status in ACTIVE_STATUSES:
                    logger.info("Reattaching to active customization for %s", project_id)
                    await runner.attach(websocket)
                    local_runner = runner
                    continue

                context = customize_contexts.get(project_id)
                if not context:
                    await websocket.send_json({"type": "error", "data": "No customize context found. Please validate first."})
                    continue

                runner = CustomizationRunner(websocket, project_id, context)
                active_customizations[project_id] = runner
                local_runner = runner

                async def run_workflow(r: CustomizationRunner, pid: str):
                    global _last_project_id
                    try:
                        if _last_project_id is not None and _last_project_id != pid:
                            await asyncio.to_thread(clear_customize_artifacts)
                        _last_project_id = pid
                        await r.run()
                    except Exception as e:
                        logger.error("Customize workflow failed for %s: %s", pid, e, exc_info=True)

                asyncio.create_task(run_workflow(runner, project_id))

            elif cmd.action == "chat":
                runner = local_runner or active_customizations.get(project_id)
                if runner and cmd.data:
                    await runner.receive_chat_message(cmd.data.get("message", ""))

            elif cmd.action == "diff_response":
                runner = local_runner or active_customizations.get(project_id)
                if runner and cmd.data:
                    await runner.receive_diff_response(
                        cmd.data.get("diff_id", ""),
                        cmd.data.get("approved", False),
                    )

            elif cmd.action == "save":
                runner = local_runner or active_customizations.get(project_id)
                if runner:
                    await runner.save_changes()

            elif cmd.action == "discard":
                runner = local_runner or active_customizations.get(project_id)
                if runner:
                    await runner.discard_changes()

    except (WebSocketDisconnect, RuntimeError):
        logger.info("WebSocket disconnected for project %s", project_id)
        if local_runner:
            local_runner.detach()
    except Exception as e:
        logger.error("WebSocket error for project %s: %s", project_id, e, exc_info=True)


@app.get("/api/customize/status/{project_id}", dependencies=[Depends(verify_api_key)])
async def get_status(project_id: str):
    runner = active_customizations.get(project_id)
    if runner:
        return {
            "active": runner.status in ACTIVE_STATUSES,
            "phase": runner.status,
            "changes_made": runner.changes_made,
        }
    return {"active": False, "phase": None, "changes_made": False}


@app.post("/api/customize/save/{project_id}", dependencies=[Depends(verify_api_key)])
async def save_project(project_id: str):
    runner = active_customizations.get(project_id)
    if not runner:
        return {"success": False, "message": "No active customization"}
    runner.detach()
    return await runner.save_changes()


@app.post("/api/cleanup", dependencies=[Depends(verify_api_key)])
async def cleanup(request: Request):
    global _last_project_id

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass

    project_id = body.get("project_id")

    if project_id:
        runner = active_customizations.pop(project_id, None)
        if runner:
            runner.cancel()
        customize_contexts.pop(project_id, None)
        return {"success": True, "message": "Session cleanup completed"}

    for runner in active_customizations.values():
        runner.cancel()
    customize_contexts.clear()
    active_customizations.clear()
    _last_project_id = None

    await asyncio.to_thread(remove_customize_container)

    success, error_msg = await asyncio.to_thread(cleanup_volumes)
    if not success:
        return {"success": False, "message": f"Cleanup failed: {error_msg}"}

    return {"success": True, "message": "Full cleanup completed"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
