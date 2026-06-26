import asyncio
import json
import logging
import os
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from models import (
    ScanValidationRequest, ScanValidationResponse,
    RemediationValidationRequest, RemediationValidationResponse,
    CreateRepoRequest, CreatePRRequest, PublishResponse,
    StoreTokenRequest,
    WebSocketCommand, StreamStatus,
)
import publish_tokens
from scans.environment import EnvironmentInitializer
from Remediation.runner import RemediationRunner, reset_last_project, get_last_project
from scans.cleanup import cleanup_volumes, cleanup_project_reports
from utils import remove_remediation_container
from scans.result_parser import get_scan_results, get_scan_status, invalidate_cache, clear_cache
from runner_base import RunnerBase
from Publish.create_repo import create_repo
from Publish.create_pr import create_pr
from report import render_vulnerability_report_pdf

logger = logging.getLogger(__name__)

app = FastAPI(
    title="DEPLAI Security",
    description="Backend API for scan validation",
    version="1.0.0"
)

API_KEY = os.environ.get("DEPLAI_SERVICE_KEY")


async def verify_api_key(x_api_key: str = Header(None)):
    if API_KEY is None:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_scans: dict[str, EnvironmentInitializer] = {}
scan_contexts: dict[str, ScanValidationRequest] = {}
active_remediations: dict[str, RemediationRunner] = {}
remediation_contexts: dict[str, ScanValidationRequest] = {}
remediation_statuses: dict[str, str] = {}

_cleanup_lock = asyncio.Lock()


async def _handle_websocket(
    websocket: WebSocket,
    project_id: str,
    create_runner,
    contexts: dict,
    active: dict,
    missing_context_msg: str,
    post_run=None,
):
    if API_KEY is not None:
        token = websocket.query_params.get("token")
        if token != API_KEY:
            await websocket.close(code=1008, reason="Invalid or missing token")
            return

    await websocket.accept()

    async def run_workflow(runner: RunnerBase):
        try:
            success = await runner.run()
            if success:
                invalidate_cache(project_id)
                await runner._send_status(StreamStatus.completed)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error("Workflow error for %s: %s", project_id, e)
            await runner._send_status(StreamStatus.error)
        finally:
            if post_run:
                post_run(project_id, runner)
            active.pop(project_id, None)

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            command = WebSocketCommand(**data)

            if command.action == "start":
                existing = active.get(project_id)
                if existing and existing.status == "running":
                    await existing.attach(websocket)
                    continue

                if project_id in active:
                    active[project_id].cancel()

                context = contexts.get(project_id)
                if context is None:
                    await websocket.send_json({
                        "type": "status",
                        "status": StreamStatus.error.value,
                        "error": missing_context_msg,
                    })
                    continue

                runner = create_runner(websocket, project_id, context)
                active[project_id] = runner

                await websocket.send_json({
                    "type": "status",
                    "status": StreamStatus.running.value,
                })

                asyncio.create_task(run_workflow(runner))

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if project_id in active:
            active[project_id].detach()


@app.post("/api/scan/validate", response_model=ScanValidationResponse, dependencies=[Depends(verify_api_key)])
async def validate_scan(request: ScanValidationRequest):
    logger.info(
        "Scan validation request: project=%s type=%s user=%s",
        request.project_id, request.project_type, request.user_id,
    )

    scan_contexts[request.project_id] = request
    invalidate_cache(request.project_id)
    remediation_statuses.pop(request.project_id, None)

    return ScanValidationResponse(
        success=True,
        message="Scan validation request received successfully",
        data=request
    )


@app.websocket("/ws/scan/{project_id}")
async def websocket_scan(websocket: WebSocket, project_id: str):
    await _handle_websocket(
        websocket, project_id,
        create_runner=lambda ws, pid, ctx: EnvironmentInitializer(ws, ctx),
        contexts=scan_contexts,
        active=active_scans,
        missing_context_msg="No scan context found. Please validate the scan first.",
    )


@app.get("/api/scan/results/{project_id}", dependencies=[Depends(verify_api_key)])
async def scan_results(project_id: str):
    success, data = await asyncio.to_thread(get_scan_results, project_id)
    if not success:
        raise HTTPException(status_code=404, detail=data)
    return {"success": True, "data": data}


@app.get("/api/scan/status/{project_id}", dependencies=[Depends(verify_api_key)])
async def scan_status(project_id: str):
    rem_status = remediation_statuses.get(project_id)
    if rem_status:
        return {"status": rem_status}
    status = await asyncio.to_thread(get_scan_status, project_id)
    return {"status": status}


@app.delete("/api/scan/results/{project_id}", dependencies=[Depends(verify_api_key)])
async def delete_scan_results(project_id: str):
    success, error_msg = await asyncio.to_thread(cleanup_project_reports, project_id)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to delete scan reports: {error_msg}")
    return {"success": True, "message": "Scan reports deleted successfully"}


@app.post("/api/remediate/validate", response_model=RemediationValidationResponse, dependencies=[Depends(verify_api_key)])
async def validate_remediation(request: RemediationValidationRequest):
    context = scan_contexts.get(request.project_id)
    if context is None:
        raise HTTPException(status_code=404, detail="No scan context found. Run a scan first.")

    remediation_contexts[request.project_id] = context
    return RemediationValidationResponse(
        success=True,
        message="Remediation validated",
    )


@app.websocket("/ws/remediate/{project_id}")
async def websocket_remediate(websocket: WebSocket, project_id: str):
    def _on_remediation_done(pid, runner):
        if hasattr(runner, 'remediation_result') and runner.remediation_result:
            status = runner.remediation_result.get('status')
            remediation_statuses[pid] = {
                "remediated": "remediated",
                "partially_remediated": "partially_remediated",
            }.get(status, "not_remediated")

    await _handle_websocket(
        websocket, project_id,
        create_runner=lambda ws, pid, ctx: RemediationRunner(ws, pid, ctx),
        contexts=remediation_contexts,
        active=active_remediations,
        missing_context_msg="No remediation context found. Please validate first.",
        post_run=_on_remediation_done,
    )


def _op_active(runner) -> dict | None:
    if runner is None:
        return None
    return {"active": runner.status == "running"}


def _require_publish_token(user_id: str) -> str:
    token = publish_tokens.get_token(user_id)
    if not token:
        raise HTTPException(status_code=401, detail="GitHub authorization required")
    return token


@app.get("/api/operations/status/{project_id}", dependencies=[Depends(verify_api_key)])
async def operation_status(project_id: str):
    return {
        "scan": _op_active(active_scans.get(project_id)),
        "remediation": _op_active(active_remediations.get(project_id)),
        "remediation_status": remediation_statuses.get(project_id),
    }


@app.get("/api/security/report-pdf/{project_id}", dependencies=[Depends(verify_api_key)])
async def get_report_pdf(project_id: str):
    # The agent artifacts volume holds only the most-recently-remediated project's
    # cycles (it's cleared on project switch), so a report can only be built for
    # that project. Refuse other ids rather than return another project's report.
    if get_last_project() != project_id:
        raise HTTPException(status_code=404, detail="Vulnerability report not available")

    ctx = remediation_contexts.get(project_id) or scan_contexts.get(project_id)
    project_name = ctx.project_name if ctx else ""

    pdf_bytes = await asyncio.to_thread(render_vulnerability_report_pdf, project_id, project_name)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Vulnerability report not available")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="vulnerability-report.pdf"'},
    )


@app.post("/api/publish/token", dependencies=[Depends(verify_api_key)])
async def store_publish_token(request: StoreTokenRequest):
    publish_tokens.store_token(
        request.user_id,
        request.token,
        request.refresh_token,
        request.expires_in,
    )
    return {"success": True}


@app.get("/api/publish/token/{user_id}", dependencies=[Depends(verify_api_key)])
async def check_publish_token(user_id: str):
    return {"has_token": publish_tokens.has_valid_token(user_id)}


@app.post("/api/publish/create-repo", response_model=PublishResponse, dependencies=[Depends(verify_api_key)])
async def publish_create_repo(request: CreateRepoRequest):
    token = _require_publish_token(request.user_id)

    success, message, url = await asyncio.to_thread(
        create_repo,
        request.project_id,
        request.project_name,
        token,
        request.owner,
    )
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return PublishResponse(success=True, message=message, url=url)


@app.post("/api/publish/create-pr", response_model=PublishResponse, dependencies=[Depends(verify_api_key)])
async def publish_create_pr(request: CreatePRRequest):
    token = _require_publish_token(request.user_id)

    success, message, url = await asyncio.to_thread(
        create_pr,
        request.project_id,
        token,
        request.owner,
        request.repo,
        request.default_branch,
    )
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return PublishResponse(success=True, message=message, url=url)


@app.post("/api/cleanup", dependencies=[Depends(verify_api_key)])
async def cleanup():
    async with _cleanup_lock:
        for runner in list(active_scans.values()):
            runner.cancel()
        for runner in list(active_remediations.values()):
            runner.cancel()
        active_scans.clear()
        active_remediations.clear()

        await asyncio.to_thread(remove_remediation_container)

        success, error_msg = await asyncio.to_thread(cleanup_volumes)
        if not success:
            raise HTTPException(status_code=500, detail=f"Cleanup failed: {error_msg}")

        scan_contexts.clear()
        remediation_contexts.clear()
        remediation_statuses.clear()
        publish_tokens.clear_all()
        reset_last_project()
        clear_cache()
        return {"success": True, "message": "Docker volumes removed successfully"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
