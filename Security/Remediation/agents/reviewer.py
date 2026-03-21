import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "reviewer.md").read_text(encoding="utf-8")


async def run(codebase_path: str, workspace_path: str) -> bool:
    prompt = (
        f"Review the modified source code at {codebase_path}. "
        f"The vulnerability data is at {workspace_path}/scan_data.json. "
        f"Validate that fixes are correct, run tests if possible, "
        f"fix minor issues directly, and revert any changes that break the system."
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=[
            "Read", "Write", "Edit", "MultiEdit",
            "Bash", "Glob", "Grep",
        ],
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
        logger.error("Reviewer failed: %s", e)
        return False
