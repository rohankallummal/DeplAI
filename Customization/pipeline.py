#!/usr/bin/env python3

import argparse
import asyncio
import json


def _on_message(msg_type: str, content: str):
    print(json.dumps({"type": msg_type, "content": content}), flush=True)


def _emit_result(success: bool, phase: str, **extra):
    data = {"success": success, "phase": phase, **extra}
    print(json.dumps({"type": "result", "data": data}), flush=True)


async def run_execute(codebase_path: str, user_request: str):
    from agent.styler import run

    _on_message("phase", "Executing changes")
    result = await run(codebase_path, user_request)

    if result.success:
        _on_message("success", "All changes executed")
    else:
        _on_message("error", f"Execution failed: {result.error}")
    _emit_result(result.success, "execute")


async def run_build(codebase_path: str):
    from agent.builder import run

    _on_message("phase", "Running build verification")
    result = await run(codebase_path)

    if result.success:
        _on_message("success", "Build passed")
    else:
        _on_message("error", f"Build failed: {result.error}")
    _emit_result(result.success, "build")


async def run_preview(codebase_path: str):
    from agent.previewer import run

    _on_message("phase", "Starting live preview")
    result = await run(codebase_path)

    if result.success:
        _on_message("success", "Preview agent finished")
    else:
        _on_message("error", f"Preview failed: {result.error}")
    _emit_result(result.success, "preview")


PHASE_RUNNERS = {
    "execute": lambda args: run_execute(args.codebase_path, args.user_request),
    "build": lambda args: run_build(args.codebase_path),
    "preview": lambda args: run_preview(args.codebase_path),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the customization pipeline")
    parser.add_argument("--phase", required=True, choices=["execute", "build", "preview"])
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--codebase-path", required=True)
    parser.add_argument("--user-request", required=False, default="")
    args = parser.parse_args()

    asyncio.run(PHASE_RUNNERS[args.phase](args))
