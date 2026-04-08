import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "analyzer.md").read_text(encoding="utf-8")


async def run(codebase_path: str, deploy_path: str) -> bool:
    prompt = (
        f"Analyze the repository at {codebase_path} and write a comprehensive "
        f"project-profile.md document to {deploy_path}/project-profile.md. "
    )

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=["Read", "Write", "Bash", "Glob", "Grep"],
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
        logger.error("Repository analyzer failed: %s", e)
        return False