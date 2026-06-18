import logging
from pathlib import Path
from dataclasses import dataclass

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "styler.md").read_text(encoding="utf-8")


@dataclass
class StylerResult:
    success: bool
    error: str | None = None


async def run(codebase_path: str, user_request: str) -> StylerResult:
    prompt = (
        f"The user wants the following changes to their frontend project:\n\n"
        f'"{user_request}"\n\n'
        f"Analyze the codebase at {codebase_path}, figure out which files need to change, "
        f"and execute the changes.\n"
        f"Use the Edit tool to make each change. Each edit will be reviewed before being applied.\n"
        f"If an edit is rejected, note it and continue with the remaining changes.\n"
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=["Read", "Write", "Glob", "Grep", "Edit", "Bash"],
        permission_mode="acceptEdits",
        cwd=codebase_path,
        max_turns=80,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        turns = 0
        async for event in query(prompt=prompt, options=options):
            turns += 1
            logger.debug("Styler agent turn %d: %s", turns, type(event).__name__)

        logger.info("Styler completed in %d turns", turns)
        return StylerResult(success=True)

    except Exception as e:
        logger.error("Styler agent failed: %s", e, exc_info=True)
        return StylerResult(success=False, error=str(e))
