import logging
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "executor.md").read_text(encoding="utf-8")
RETRY_ADDENDUM = (PROMPT_DIR / "executor-retry.md").read_text(encoding="utf-8")


async def run(
    codebase_path: str,
    workspace_path: str,
    cycle_num: int = 1,
    cycle_history: str = "",
    use_web_tools: bool = False,
) -> bool:
    tools = [
        "Read", "Write", "Edit", "MultiEdit",
        "Bash", "Glob", "Grep", "Agent",
    ]
    if use_web_tools:
        tools.extend(["WebSearch", "WebFetch"])

    system_prompt = SYSTEM_PROMPT
    if cycle_num > 1 and cycle_history:
        system_prompt += RETRY_ADDENDUM.format(
            cycle_num=cycle_num,
            cycle_history=cycle_history,
        )

    prompt = (
        f"Read the codebase context at {workspace_path}/context.md and the "
        f"vulnerability scan results at {workspace_path}/scan_data.json. "
        f"Fix all vulnerabilities in the source code at {codebase_path}."
    )
    if cycle_num > 1:
        prompt += (
            f"\n\nThis is cycle {cycle_num}. Review the cycle history in your "
            f"system prompt and use DIFFERENT strategies for previously failed fixes."
        )

    options = ClaudeAgentOptions(
        model="sonnet",
        allowed_tools=tools,
        permission_mode="bypassPermissions",
        cwd=codebase_path,
        max_turns=80,
        system_prompt=system_prompt,
    )

    try:
        async for _ in query(prompt=prompt, options=options):
            pass
        return True
    except Exception as e:
        logger.error("Executor failed: %s", e)
        return False
