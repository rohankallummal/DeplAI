import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT_TEMPLATE = (PROMPT_DIR / "verifier.md").read_text(encoding="utf-8")


async def run(
    workspace_path: str,
    project_name: str,
    project_id: str,
    cycle_num: int,
) -> bool:
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        project_name=project_name,
        project_id=project_id,
        cycle_num=cycle_num,
    )

    prompt = (
        f"Run the security scanners for cycle {cycle_num} and confirm "
        f"the JSON result files were generated successfully."
    )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=["Read", "Write", "Bash", "Glob", "Grep"],
        permission_mode="bypassPermissions",
        cwd=workspace_path,
        max_turns=30,
        system_prompt=system_prompt,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Verifier failed: %s", e)
        return False
