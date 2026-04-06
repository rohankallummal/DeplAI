import logging
from pathlib import Path
from dataclasses import dataclass, field

from claude_agent_sdk import query, ClaudeAgentOptions

logger = logging.getLogger(__name__)

PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompt"
SYSTEM_PROMPT = (PROMPT_DIR / "terraform.md").read_text(encoding="utf-8")

EXPECTED_FILES = ["main.tf", "variables.tf", "outputs.tf", "backend.tf", "provider.tf"]


@dataclass
class TerraformResult:
    success: bool
    files_created: list[str] = field(default_factory=list)
    error: str | None = None


async def run(deploy_path: str, state_key: str, phase: str = "plan") -> TerraformResult:
    tf_dir = Path(deploy_path) / "terraform" / "code"
    tf_dir.mkdir(parents=True, exist_ok=True)

    if phase == "plan":
        prompt = (
            f"Read the deployment architecture at {deploy_path}/deployment.md.\n\n"
            f"1. Generate production-ready Terraform files in {deploy_path}/terraform/code/.\n"
            f"2. Run the full CLI cycle: fmt → validate → init → plan.\n"
            f"3. If any step fails, diagnose, fix, and retry (up to 3 attempts).\n"
            f"4. Stop after a successful plan. Do NOT run terraform apply.\n\n"
            f"The state key for S3 backend is: {state_key}\n"
        )
    elif phase == "apply":
        prompt = (
            f"The Terraform plan has been approved by the user.\n\n"
            f"1. Run: terraform apply -auto-approve {deploy_path}/terraform/code/terraform.plan\n"
            f"2. If apply fails, follow the Apply Failure & Partial State Process in your instructions.\n"
            f"3. After successful apply, save outputs:\n"
            f"   terraform output -json > {deploy_path}/terraform/code/outputs.json\n\n"
            f"The state key is: {state_key}\n"
        )
    else:
        return TerraformResult(success=False, error=f"Unknown phase: {phase}")

    options = ClaudeAgentOptions(
        model="opus",
        allowed_tools=[
            "Read", "Write", "Bash", "WebSearch", "WebFetch",
            "mcp__terraform",
        ],
        permission_mode="bypassPermissions",
        cwd=deploy_path,
        max_turns=75,
        system_prompt=SYSTEM_PROMPT,
    )

    try:
        turns = 0
        async for event in query(prompt=prompt, options=options):
            turns += 1
            logger.debug("Terraform agent turn %d (%s): %s", turns, phase, type(event).__name__)

        if phase == "plan":
            created = [f for f in EXPECTED_FILES if (tf_dir / f).exists()]
            missing = [f for f in EXPECTED_FILES if f not in created]

            if missing:
                return TerraformResult(
                    success=False,
                    files_created=created,
                    error=f"Missing expected files: {missing}",
                )

            plan_file = tf_dir / "terraform.plan"
            if not plan_file.exists():
                return TerraformResult(
                    success=False,
                    files_created=created,
                    error="Plan file not created — plan likely failed",
                )

            logger.info("Terraform plan completed in %d turns. Files: %s", turns, created)
            return TerraformResult(success=True, files_created=created)

        elif phase == "apply":
            outputs_file = tf_dir / "outputs.json"
            if not outputs_file.exists():
                return TerraformResult(
                    success=False,
                    error="outputs.json not created — apply likely failed",
                )

            logger.info("Terraform apply completed in %d turns", turns)
            return TerraformResult(success=True)

    except Exception as e:
        logger.error("Terraform agent failed (%s): %s", phase, e, exc_info=True)
        return TerraformResult(
            success=False,
            files_created=[f for f in EXPECTED_FILES if (tf_dir / f).exists()],
            error=str(e),
        )
