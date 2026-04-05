import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "clarify.md").read_text(encoding="utf-8")


async def run(deploy_path: str) -> bool:
    prompt = (
        f"Read the context file at {deploy_path}/context.md. "
        f"Based on the repository analysis, generate targeted clarification questions "
        f"and write them as JSON to {deploy_path}/questions.json. "
    )

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=["Read", "Write", "Bash", "WebSearch", "WebFetch"],
        permission_mode="bypassPermissions",
        cwd=deploy_path,
        max_turns=30,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Clarification agent failed: %s", e)
        return False
