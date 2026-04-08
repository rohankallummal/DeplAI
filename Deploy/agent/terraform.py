import logging
from pathlib import Path
from dataclasses import dataclass, field

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "terraform.md").read_text(encoding="utf-8")

REQUIRED_FILES = ["provider.tf", "variables.tf", "outputs.tf", "backend.tf", "locals.tf"]
MIN_PLAN_SIZE = 100  


@dataclass
class TerraformResult:
    success: bool
    files_created: list[str] = field(default_factory=list)
    error: str | None = None


def _discover_tf_files(tf_dir: Path) -> list[str]:
    """Return all .tf filenames in the directory."""
    return [f.name for f in tf_dir.glob("*.tf") if f.is_file()]


def _validate_plan_file(tf_dir: Path) -> str | None:
    """Return an error message if the plan file is missing or corrupt, else None."""
    plan_file = tf_dir / "terraform.plan"
    if not plan_file.exists():
        return "Plan file not created — plan likely failed"
    if plan_file.stat().st_size < MIN_PLAN_SIZE:
        return f"Plan file is suspiciously small ({plan_file.stat().st_size} bytes) — may be corrupt"
    return None


async def run(deploy_path: str, state_key: str, phase: str = "plan") -> TerraformResult:
    tf_dir = Path(deploy_path) / "terraform" / "code"
    tf_dir.mkdir(parents=True, exist_ok=True)

    if phase == "plan":
        prompt = (
            f"Read the repository context at {deploy_path}/project-profile.md "
            f"and the Question-Answer pairs at {deploy_path}/QnA.json.\n\n"
            f"Generation production ready Terraform code where the plan succeeds. \n "
            f"write Terraform files to {tf_dir}/. "
            f"The state key for S3 backend is: {state_key}\n"
        )
    elif phase == "apply":
        prompt = (
            f"The Terraform plan has been approved. "
            f"Apply {tf_dir}/terraform.plan and save outputs to {tf_dir}/outputs.json. "
            f"State key: {state_key}\n"
        )
    else:
        return TerraformResult(success=False, error=f"Unknown phase: {phase}")

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=[
            "Read", "Write", "Bash",
            "WebSearch", "WebFetch",
            "mcp__terraform",
        ],
        permission_mode="bypassPermissions",
        cwd=str(tf_dir),
        max_turns=75,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        turns = 0
        async for event in query(prompt=prompt, options=options):
            turns += 1
            logger.debug("Terraform agent turn %d (%s): %s", turns, phase, type(event).__name__)

        if phase == "plan":
            created = _discover_tf_files(tf_dir)
            missing_required = [f for f in REQUIRED_FILES if f not in created]

            if missing_required:
                return TerraformResult(
                    success=False,
                    files_created=created,
                    error=f"Missing required files: {missing_required}",
                )

            plan_error = _validate_plan_file(tf_dir)
            if plan_error:
                return TerraformResult(
                    success=False,
                    files_created=created,
                    error=plan_error,
                )

            logger.info(
                "Terraform plan completed in %d turns. Files: %s",
                turns, created,
            )
            return TerraformResult(success=True, files_created=created)

        elif phase == "apply":
            outputs_file = tf_dir / "outputs.json"
            if not outputs_file.exists():
                return TerraformResult(
                    success=False,
                    error="outputs.json not created — apply likely failed",
                )

            created = _discover_tf_files(tf_dir)
            logger.info("Terraform apply completed in %d turns", turns)
            return TerraformResult(success=True, files_created=created)

    except Exception as e:
        logger.error("Terraform agent failed (%s): %s", phase, e, exc_info=True)
        return TerraformResult(
            success=False,
            files_created=_discover_tf_files(tf_dir),
            error=str(e),
        )