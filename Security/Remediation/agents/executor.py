import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT_TEMPLATE = (PROMPT_DIR / "executor.md").read_text(encoding="utf-8")


async def run(
    codebase_path: str,
    workspace_path: str,
    project_name: str,
    project_id: str,
) -> bool:
    tools = [
        "Read", "Write", "Edit",
        "Bash", "Glob", "Grep", "Agent",
        "mcp__firecrawl",
    ]

    system_prompt = (
        SYSTEM_PROMPT_TEMPLATE
        .replace("{project_name}", project_name)
        .replace("{project_id}", project_id)
    )

    prompt = (
        f"Read the codebase context at {workspace_path}/context.md and the "
        f"vulnerability scan results at {workspace_path}/scan_data.json. "
        f"Fix all vulnerabilities in the source code at {codebase_path}, "
    )

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=tools,
        permission_mode="bypassPermissions",
        cwd=codebase_path,
        max_turns=240,
        system_prompt=system_prompt,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Executor failed: %s", e)
        return False
