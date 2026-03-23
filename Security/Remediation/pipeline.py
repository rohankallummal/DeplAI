#!/usr/bin/env python3

import argparse
import asyncio
import json


async def _on_message(msg_type: str, content: str):
    print(json.dumps({"type": msg_type, "content": content}), flush=True)


async def main(project_name: str, project_id: str):
    from Remediation.orchestrator import Orchestrator

    orchestrator = Orchestrator(project_name, project_id, _on_message)
    result = await orchestrator.run()

    print(json.dumps({"type": "result", "data": result}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the remediation pipeline")
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-id", required=True)
    args = parser.parse_args()

    asyncio.run(main(args.project_name, args.project_id))
