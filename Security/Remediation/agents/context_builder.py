import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "context-builder.md").read_text(encoding="utf-8")


async def run(codebase_path: str, workspace_path: str) -> bool:
    prompt = (
        f"Analyze the codebase at {codebase_path} and write a comprehensive "
        f"context document to {workspace_path}/context.md."
        f"Be thorough every downstream agent depends on your analysis."
    )

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=["Read", "Write", "Bash", "Glob", "Grep", "Agent"],
        permission_mode="bypassPermissions",
        cwd=codebase_path,
        max_turns=50,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Context builder failed: %s", e)
        return False
