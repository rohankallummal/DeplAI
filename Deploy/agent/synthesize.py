import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "synthesize.md").read_text(encoding="utf-8")


async def run(deploy_path: str) -> bool:
    prompt = (
        f"Read the repository context at {deploy_path}/context.md "
        f"and the user's answers at {deploy_path}/answers.json. "
        f"Generate a comprehensive deployment architecture document "
        f"and write it to {deploy_path}/deployment.md."
    )

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=["Read", "Write", "Bash", "WebSearch", "WebFetch"],
        permission_mode="bypassPermissions",
        cwd=deploy_path,
        max_turns=50,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Synthesis agent failed: %s", e)
        return False
