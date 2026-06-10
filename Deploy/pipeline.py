#!/usr/bin/env python3

import argparse
import asyncio
import json


async def _on_message(msg_type: str, content: str):
    print(json.dumps({"type": msg_type, "content": content}), flush=True)


def _emit_result(success: bool, phase: str):
    print(json.dumps({"type": "result", "data": {"success": success, "phase": phase}}), flush=True)


def _state_key(project_id: str, project_name: str, user_id: str) -> str:
    return f"{project_id}_{project_name}_{user_id}".replace(" ", "_").replace("-", "_")


async def run_analyze():
    from agent.analyzer import run

    await _on_message("phase", "Analyzing repository structure")
    success = await run("/workspace/codebase", "/workspace/deploy")

    if success:
        await _on_message("success", "Repository analysis complete — project-profile.md generated")
    else:
        await _on_message("error", "Repository analysis failed")
    _emit_result(success, "analyze")


async def run_clarify():
    from agent.clarify import run

    await _on_message("phase", "Generating clarification questions")
    deploy_path = "/workspace/deploy"
    success = await run(deploy_path)

    if not success:
        await _on_message("error", "Failed to generate clarification questions")
    else:
        try:
            with open(f"{deploy_path}/questions.json") as f:
                questions = json.load(f)
            await _on_message("success", "Clarification questions ready")
            print(json.dumps({"type": "questions", "data": questions}), flush=True)
        except Exception as e:
            await _on_message("error", f"Failed to read questions: {e}")
            success = False
    _emit_result(success, "clarify")


async def _run_terraform_phase(project_name: str, project_id: str, user_id: str, tf_phase: str, phase_msg: str, success_msg: str, error_prefix: str, result_phase: str):
    from agent.terraform import run

    await _on_message("phase", phase_msg)
    result = await run("/workspace/deploy", _state_key(project_id, project_name, user_id), phase=tf_phase)

    if result.success:
        await _on_message("success", success_msg)
    else:
        await _on_message("error", f"{error_prefix}: {result.error}")
    _emit_result(result.success, result_phase)


PHASE_RUNNERS = {
    "analyze": lambda args: run_analyze(),
    "clarify": lambda args: run_clarify(),
    "terraform": lambda args: _run_terraform_phase(
        args.project_name, args.project_id, args.user_id,
        tf_phase="plan",
        phase_msg="Generating Terraform code and running plan",
        success_msg="Terraform configuration generated and plan succeeded",
        error_prefix="Terraform generation/planning failed",
        result_phase="terraform",
    ),
    "terraform_apply": lambda args: _run_terraform_phase(
        args.project_name, args.project_id, args.user_id,
        tf_phase="apply",
        phase_msg="Applying Terraform infrastructure",
        success_msg="Terraform apply succeeded — infrastructure provisioned",
        error_prefix="Terraform apply failed",
        result_phase="terraform_apply",
    ),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the deploy pipeline")
    parser.add_argument("--phase", required=True, choices=list(PHASE_RUNNERS.keys()))
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--user-id", required=False, default="")
    args = parser.parse_args()

    asyncio.run(PHASE_RUNNERS[args.phase](args))
