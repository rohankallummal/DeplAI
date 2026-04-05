#!/usr/bin/env python3

import argparse
import asyncio
import json


async def _on_message(msg_type: str, content: str):
    print(json.dumps({"type": msg_type, "content": content}), flush=True)


def _emit_result(success: bool, phase: str):
    print(json.dumps({"type": "result", "data": {"success": success, "phase": phase}}), flush=True)


async def run_analyze(project_name: str, project_id: str):
    from agent.analyzer import run

    await _on_message("phase", "Analyzing repository structure")
    success = await run("/workspace/codebase", "/workspace/deploy")

    if success:
        await _on_message("success", "Repository analysis complete — context.md generated")
    else:
        await _on_message("error", "Repository analysis failed")
    _emit_result(success, "analyze")


async def run_clarify(project_name: str, project_id: str):
    from agent.clarify import run

    await _on_message("phase", "Generating clarification questions")
    deploy_path = "/workspace/deploy"
    success = await run(deploy_path)

    if success:
        try:
            with open(f"{deploy_path}/questions.json") as f:
                questions = json.load(f)
            await _on_message("success", "Clarification questions ready")
            print(json.dumps({"type": "questions", "data": questions}), flush=True)
        except Exception as e:
            await _on_message("error", f"Failed to read questions: {e}")
            success = False
    else:
        await _on_message("error", "Failed to generate clarification questions")
    _emit_result(success, "clarify")


async def run_synthesize(project_name: str, project_id: str):
    from agent.synthesize import run

    await _on_message("phase", "Generating deployment architecture")
    success = await run("/workspace/deploy")

    if success:
        await _on_message("success", "Deployment architecture generated — deployment.md ready")
    else:
        await _on_message("error", "Architecture synthesis failed")
    _emit_result(success, "synthesize")


async def run_terraform(project_name: str, project_id: str, user_id: str):
    from agent.terraform import run

    await _on_message("phase", "Generating Terraform code and running plan")
    state_key = f"{project_id}_{project_name}_{user_id}".replace(" ", "_").replace("-", "_")
    result = await run("/workspace/deploy", state_key, phase="plan")

    if result.success:
        await _on_message("success", "Terraform configuration generated and plan succeeded")
    else:
        await _on_message("error", f"Terraform generation/planning failed: {result.error}")
    _emit_result(result.success, "terraform")


async def run_terraform_apply(project_name: str, project_id: str, user_id: str):
    from agent.terraform import run

    await _on_message("phase", "Applying Terraform infrastructure")
    state_key = f"{project_id}_{project_name}_{user_id}".replace(" ", "_").replace("-", "_")
    result = await run("/workspace/deploy", state_key, phase="apply")

    if result.success:
        await _on_message("success", "Terraform apply succeeded — infrastructure provisioned")
    else:
        await _on_message("error", f"Terraform apply failed: {result.error}")
    _emit_result(result.success, "terraform_apply")


PHASE_RUNNERS = {
    "analyze": lambda args: run_analyze(args.project_name, args.project_id),
    "clarify": lambda args: run_clarify(args.project_name, args.project_id),
    "synthesize": lambda args: run_synthesize(args.project_name, args.project_id),
    "terraform": lambda args: run_terraform(args.project_name, args.project_id, args.user_id),
    "terraform_apply": lambda args: run_terraform_apply(args.project_name, args.project_id, args.user_id),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the deploy pipeline")
    parser.add_argument("--phase", required=True, choices=list(PHASE_RUNNERS.keys()))
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--user-id", required=False, default="")
    args = parser.parse_args()

    asyncio.run(PHASE_RUNNERS[args.phase](args))
