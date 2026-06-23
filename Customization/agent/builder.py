import logging
from pathlib import Path
from dataclasses import dataclass

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "builder.md").read_text(encoding="utf-8")


@dataclass
class BuilderResult:
    success: bool
    error: str | None = None


async def run(codebase_path: str) -> BuilderResult:
    prompt = (
        f"The codebase at {codebase_path} has just been customized.\n"
        f"Your job is to:\n"
        f"1. Detect the package manager used by this project.\n"
        f"2. Install dependencies.\n"
        f"3. Run the build command.\n"
        f"4. If the build fails, fix the errors and re-run the build (up to 3 attempts).\n\n"
        f"Start by reading {codebase_path}/package.json and checking for lock files.\n"
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=["Read", "Glob", "Grep", "Edit", "Bash", "Monitor"],
        permission_mode="acceptEdits",
        cwd=codebase_path,
        max_turns=50,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        turns = 0
        async for event in query(prompt=prompt, options=options):
            turns += 1
            logger.debug("Builder agent turn %d: %s", turns, type(event).__name__)

        logger.info("Builder completed in %d turns", turns)
        return BuilderResult(success=True)

    except Exception as e:
        logger.error("Builder agent failed: %s", e, exc_info=True)
        return BuilderResult(success=False, error=str(e))
