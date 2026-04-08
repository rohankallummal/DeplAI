#!/usr/bin/env python3

import argparse
import asyncio
import json


async def _on_message(msg_type: str, content: str):
    print(json.dumps({"type": msg_type, "content": content}), flush=True)


def _emit_result(success: bool, phase: str, **extra):
    data = {"success": success, "phase": phase, **extra}
    print(json.dumps({"type": "result", "data": data}), flush=True)


async def run_execute(project_name: str, project_id: str, user_request: str):
    from agent.styler import run

    await _on_message("phase", "Executing changes")
    result = await run("/workspace/codebase", user_request)

    if result.success:
        await _on_message("success", "All changes executed")
    else:
        await _on_message("error", f"Execution failed: {result.error}")
    _emit_result(
        result.success,
        "execute",
        files_modified=result.files_modified,
    )


PHASE_RUNNERS = {
    "execute": lambda args: run_execute(args.project_name, args.project_id, args.user_request),
}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the customization pipeline")
    parser.add_argument("--phase", required=True, choices=list(PHASE_RUNNERS.keys()))
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--user-request", required=False, default="")
    args = parser.parse_args()

    asyncio.run(PHASE_RUNNERS[args.phase](args))
