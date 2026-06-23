import logging
from pathlib import Path
from dataclasses import dataclass

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "previewer.md").read_text(encoding="utf-8")


@dataclass
class PreviewResult:
    # NOTE: success here means only "the agent ran without raising" — it is NOT the
    # readiness signal. The dev server is launched detached and outlives the agent,
    # so the orchestrator (preview.py) determines ready/error from the agent-written
    # /workspace/preview/status.json, not from this return value.
    success: bool
    error: str | None = None


async def run(codebase_path: str) -> PreviewResult:
    prompt = (
        f"Start the frontend development server for the project at {codebase_path} "
        f"and make it reachable through the Nginx gateway.\n\n"
        f"Follow your system prompt exactly:\n"
        f"1. Detect the framework (Node/JS web frameworks only this release).\n"
        f"2. Install dependencies.\n"
        f"3. Launch the dev server detached, bound to 0.0.0.0, with host-check off.\n"
        f"4. Verify it responds, then write /workspace/preview/status.json.\n\n"
        f"Begin by reading {codebase_path}/package.json and checking for lock files.\n"
        f"The dev server MUST keep running after you exit, so launch it with "
        f"`setsid nohup … > /workspace/preview/server.log 2>&1 < /dev/null &`.\n"
        f"Always write your final state to /workspace/preview/status.json before stopping.\n"
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=["Read", "Glob", "Grep", "Edit", "Bash", "Monitor"],
        permission_mode="acceptEdits",
        cwd=codebase_path,
        max_turns=60,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        turns = 0
        async for event in query(prompt=prompt, options=options):
            turns += 1
            logger.debug("Previewer agent turn %d: %s", turns, type(event).__name__)

        logger.info("Previewer completed in %d turns", turns)
        return PreviewResult(success=True)

    except Exception as e:
        logger.error("Previewer agent failed: %s", e, exc_info=True)
        return PreviewResult(success=False, error=str(e))
