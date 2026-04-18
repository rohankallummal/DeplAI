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

logging.getLogger("fontTools").setLevel(logging.WARNING)
logging.getLogger("fontTools.subset").setLevel(logging.WARNING)
logging.getLogger("fontTools.ttLib").setLevel(logging.WARNING)
logging.getLogger("weasyprint").setLevel(logging.WARNING)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from models import (
    DeployValidationRequest, DeployValidationResponse,
    WebSocketCommand, StreamStatus, DestroyRequest,
)
from runner import DeployRunner
from pdf import render_cost_pdf
from utils import (
    remove_deploy_container, cleanup_volumes, clear_deploy_artifacts,
    read_volume_file, run_terraform_command,
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="DEPLAI Deploy",
    description="Backend API for deployment orchestration",
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

deploy_contexts: dict[str, DeployValidationRequest] = {}
active_deploys: dict[str, DeployRunner] = {}

_last_project_id: str | None = None

ACTIVE_STATUSES = frozenset({"running", "analyzing", "clarifying", "terraforming", "costing"})


@app.post("/api/deploy/validate", response_model=DeployValidationResponse, dependencies=[Depends(verify_api_key)])
async def validate_deploy(request: DeployValidationRequest):
    logger.info(
        "Deploy validation request: project=%s type=%s user=%s",
        request.project_id, request.project_type, request.user_id,
    )

    deploy_contexts[request.project_id] = request

    return DeployValidationResponse(
        success=True,
        message="Deploy validation request received successfully",
    )


@app.websocket("/ws/deploy/{project_id}")
async def websocket_deploy(websocket: WebSocket, project_id: str):
    global _last_project_id

    if API_KEY is not None:
        token = websocket.query_params.get("token")
        if token != API_KEY:
            await websocket.close(code=1008, reason="Invalid or missing token")
            return

    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            command = WebSocketCommand(**data)

            if command.action == "start":
                existing = active_deploys.get(project_id)
                if existing and existing.status in ACTIVE_STATUSES:
                    await existing.attach(websocket)
                    continue

                if project_id in active_deploys:
                    active_deploys[project_id].cancel()

                context = deploy_contexts.get(project_id)
                if context is None:
                    await websocket.send_json({
                        "type": "status",
                        "status": StreamStatus.error.value,
                        "error": "No deploy context found. Please validate first.",
                    })
                    continue

                if _last_project_id is not None and _last_project_id != project_id:
                    await asyncio.to_thread(clear_deploy_artifacts)
                    try:
                        from utils import get_docker_client, DEPLOY_CONTAINER_NAME
                        c = get_docker_client().containers.get(DEPLOY_CONTAINER_NAME)
                        c.restart(timeout=5)
                    except Exception:
                        pass

                _last_project_id = project_id

                runner = DeployRunner(websocket, project_id, context)
                active_deploys[project_id] = runner

                await websocket.send_json({
                    "type": "status",
                    "status": StreamStatus.running.value,
                })

                async def run_workflow():
                    try:
                        success = await runner.run()
                        if success:
                            await runner._send_status(StreamStatus.completed)
                        elif runner._user_cancelled:
                            await runner._send_status(StreamStatus.cancelled)
                            deploy_contexts.pop(project_id, None)
                    except WebSocketDisconnect:
                        pass
                    except Exception as e:
                        logger.error("Deploy workflow error for %s: %s", project_id, e)
                        await runner._send_status(StreamStatus.error)
                    finally:
                        active_deploys.pop(project_id, None)

                asyncio.create_task(run_workflow())

            elif command.action == "answer":
                runner = active_deploys.get(project_id)
                if runner:
                    await runner.receive_answers(command.data or {})

            elif command.action == "deploy_confirmation":
                runner = active_deploys.get(project_id)
                if runner:
                    confirmed = command.data.get("confirmed", False) if command.data else False
                    await runner.receive_deploy_confirmation(confirmed)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if project_id in active_deploys:
            active_deploys[project_id].detach()


@app.get("/api/deploy/status/{project_id}", dependencies=[Depends(verify_api_key)])
async def deploy_status(project_id: str):
    runner = active_deploys.get(project_id)
    if runner:
        return {
            "active": runner.status in ACTIVE_STATUSES,
            "phase": runner.status,
        }
    return {"active": False, "phase": None}


def parse_terraform_outputs(raw: dict) -> dict:
    endpoints = []
    credentials = []
    inventory = []

    endpoint_keywords = {"url", "endpoint", "dns", "host", "lb", "address"}
    credential_keywords = {"password", "secret", "key", "token", "credential"}

    for key, obj in raw.items():
        if not isinstance(obj, dict):
            continue

        value = obj.get("value")
        is_sensitive = obj.get("sensitive", False)
        key_lower = key.lower()

        if is_sensitive or any(kw in key_lower for kw in credential_keywords):
            credentials.append({
                "name": key,
                "value": value,
                "sensitive": is_sensitive
            })
        elif any(kw in key_lower for kw in endpoint_keywords):
            endpoints.append({
                "name": key,
                "value": value
            })
        else:
            inventory.append({
                "name": key,
                "value": value
            })

    return {
        "endpoints": endpoints,
        "credentials": credentials,
        "inventory": inventory
    }


def extract_cost_resources(cost_data: dict) -> list:
    resources = []
    for project in cost_data.get("projects", []):
        breakdown = project.get("breakdown", {})
        for resource in breakdown.get("resources", []):
            monthly_cost = float(resource.get("monthlyCost", 0) or 0)
            if monthly_cost > 0:
                resources.append({
                    "name": resource.get("name", "Unknown"),
                    "monthly_cost": monthly_cost,
                })
    return sorted(resources, key=lambda r: r["monthly_cost"], reverse=True)


@app.get("/api/deploy/outputs/{project_id}", dependencies=[Depends(verify_api_key)])
async def get_deploy_outputs(project_id: str):
    try:
        raw_outputs = await asyncio.to_thread(read_volume_file, "terraform/code/outputs.json")
        if not raw_outputs:
            return {"success": False, "error": "No terraform outputs found"}

        outputs_dict = json.loads(raw_outputs)
        parsed = parse_terraform_outputs(outputs_dict)

        cost_resources = []
        try:
            raw_cost = await asyncio.to_thread(read_volume_file, "terraform/cost/cost_estimate.json")
            if raw_cost:
                cost_data = json.loads(raw_cost)
                cost_resources = extract_cost_resources(cost_data)
        except Exception as e:
            logger.warning(f"Could not read cost estimate: {e}")

        parsed["cost_resources"] = cost_resources
        return {"success": True, "data": parsed}

    except Exception as e:
        logger.error(f"Error getting deploy outputs: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


@app.get("/api/deploy/cost-pdf/{project_id}", dependencies=[Depends(verify_api_key)])
async def get_cost_pdf(project_id: str):
    context = deploy_contexts.get(project_id)
    project_name = context.project_name if context else ""

    pdf_bytes = await asyncio.to_thread(render_cost_pdf, project_name)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Cost estimate not available")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="cost-breakdown.pdf"'},
    )


@app.post("/api/deploy/destroy", dependencies=[Depends(verify_api_key)])
async def destroy_deploy(request: DestroyRequest):
    context = deploy_contexts.get(request.project_id)
    if not context:
        raise HTTPException(status_code=404, detail="No deploy context found")

    try:
        state_key = f"{request.project_id}_{context.project_name}_{context.user_id}".replace(" ", "_").replace("-", "_")
        aws_env = {
            "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
            "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
            "AWS_DEFAULT_REGION": os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
            "TF_S3_BUCKET": os.environ.get("TF_S3_BUCKET", ""),
        }

        logger.info(f"Running terraform init for destroy: {request.project_id}")
        init_cmd = [
            "init",
            "-backend-config", f"bucket={aws_env['TF_S3_BUCKET']}",
            "-backend-config", f"key={state_key}/terraform.tfstate",
            "-backend-config", f"region={aws_env['AWS_DEFAULT_REGION']}",
            "-backend-config", "encrypt=true",
        ]
        init_code, init_output = await asyncio.to_thread(
            run_terraform_command, init_cmd, aws_env
        )
        if init_code != 0:
            logger.error(f"Terraform init failed: {init_output}")
            return {
                "success": False,
                "message": f"Failed to initialize terraform: {init_output}"
            }

        logger.info(f"Running terraform destroy: {request.project_id}")
        destroy_cmd = ["destroy", "-auto-approve", "-json"]
        destroy_code, destroy_output = await asyncio.to_thread(
            run_terraform_command, destroy_cmd, aws_env
        )

        if destroy_code == 0:
            logger.info(f"Terraform destroy succeeded: {request.project_id}")
            return {
                "success": True,
                "message": "All resources destroyed successfully"
            }
        else:
            logger.error(f"Terraform destroy failed: {destroy_output}")
            return {
                "success": False,
                "message": f"Terraform destroy failed: {destroy_output}"
            }

    except Exception as e:
        logger.error(f"Destroy deploy error: {e}", exc_info=True)
        return {
            "success": False,
            "message": f"Error during destroy: {str(e)}"
        }


@app.post("/api/cleanup", dependencies=[Depends(verify_api_key)])
async def cleanup():
    await asyncio.to_thread(remove_deploy_container)
    success, error_msg = await asyncio.to_thread(cleanup_volumes)
    if not success:
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {error_msg}")
    deploy_contexts.clear()
    active_deploys.clear()
    global _last_project_id
    _last_project_id = None
    return {"success": True, "message": "Docker volumes removed successfully"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
