import asyncio
import json
import logging
import os
import queue as thread_queue

from fastapi import WebSocket

from models import DeployValidationRequest, StreamStatus
from runner_base import RunnerBase
from utils import (
    get_docker_client,
    get_or_create_deploy_container,
    CODEBASE_VOLUME,
    decode_output,
)
from infracost import estimate_cost, cost_estimate_to_dict, get_cost_table

logger = logging.getLogger(__name__)

TOTAL_STEPS = 10


class DeployRunner(RunnerBase):

    def __init__(self, websocket: WebSocket, project_id: str, context: DeployValidationRequest):
        super().__init__(websocket, TOTAL_STEPS)
        self.project_id = project_id
        self.context = context
        self._container = None
        self._answers_event = asyncio.Event()
        self._answers_data: dict | None = None
        self._deploy_confirmed_event = asyncio.Event()
        self._deploy_confirmed = False
        self._user_cancelled = False

    def cancel(self):
        super().cancel()
        if self._container:
            try:
                self._container.exec_run(
                    ["pkill", "-f", "pipeline.py"],
                    detach=True,
                )
            except Exception:
                pass

    async def receive_answers(self, answers: dict):
        self._answers_data = answers
        self._answers_event.set()

    async def receive_deploy_confirmation(self, confirmed: bool):
        self._deploy_confirmed = confirmed
        self._deploy_confirmed_event.set()

    async def _run_pipeline(self) -> bool:
        logger.info("Preparing deploy container")
        self._container = await asyncio.to_thread(get_or_create_deploy_container)
        self._check_cancelled()

        logger.info(f"Copying codebase into Docker volume for project {self.project_id}")
        success, error_msg = await asyncio.to_thread(self._copy_codebase_to_volume)
        if not success:
            return await self._terminate(f"Failed to copy codebase: {error_msg}")
        self._check_cancelled()

        await asyncio.to_thread(
            self._container.exec_run,
            [
                "sh", "-c",
                "chmod 666 /var/run/docker.sock 2>/dev/null; "
                "chown -R agent:agent /workspace /home/agent 2>/dev/null; "
                "chmod -R a+r /app 2>/dev/null",
            ],
            user="root",
        )

        exit_code, diag_output = await asyncio.to_thread(
            self._container.exec_run,
            ["claude", "--version"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )
        diag_text = decode_output(diag_output).strip()
        if exit_code != 0:
            return await self._terminate(f"Claude CLI check failed (exit {exit_code}): {diag_text}")
        logger.info(f"Claude CLI ready ({diag_text})")

        exit_code, tf_output = await asyncio.to_thread(
            self._container.exec_run,
            ["terraform", "--version"],
            user="agent",
        )
        tf_text = decode_output(tf_output).strip()
        if exit_code != 0:
            return await self._terminate(f"Terraform CLI check failed (exit {exit_code}): {tf_text}")
        logger.info(f"Terraform CLI ready ({tf_text.splitlines()[0]})")

        # Check MCP server connectivity (Section 5.6)
        mcp_ok = await self._check_mcp_connectivity()
        if not mcp_ok:
            logger.warning("Terraform MCP server not reachable — registry tools will be unavailable")

        # Phase 1: Repository Analysis (Agent 1)
        await self._send_status(StreamStatus.analyzing)
        logger.info("Starting repository analysis")

        analyze_result = await self._run_agent_phase("analyze")
        if not analyze_result or not analyze_result.get("success"):
            return await self._terminate("Repository analysis failed")
        logger.info("Repository analysis complete")

        self._check_cancelled()

        # Phase 2: Generate Clarification Questions (Agent 2 - Phase 1)
        logger.info("Preparing clarification questions")

        clarify_result = await self._run_agent_phase("clarify")
        if not clarify_result or not clarify_result.get("success"):
            return await self._terminate("Failed to generate clarification questions")

        self._check_cancelled()

        await self._send_status(StreamStatus.clarifying)
        logger.info("Waiting for user responses")
        await self._answers_event.wait()
        self._check_cancelled()

        if self._answers_data is None:
            return await self._terminate("No answers received")

        answers_json = json.dumps(self._answers_data.get("answers", []), indent=2)
        await asyncio.to_thread(
            self._container.exec_run,
            ["sh", "-c", f"cat > /workspace/deploy/QnA.json << 'ANSWERS_EOF'\n{answers_json}\nANSWERS_EOF"],
            user="agent",
            environment={"HOME": "/home/agent"},
        )

        # Phase 3: Terraform — Generate + Plan
        await self._send_status(StreamStatus.terraforming)
        logger.info("Starting Terraform generation and planning")

        await asyncio.to_thread(self._setup_terraform_directories)

        aws_env = {
            "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
            "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
            "AWS_DEFAULT_REGION": os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
            "TF_S3_BUCKET": os.environ.get("TF_S3_BUCKET", ""),
        }

        terraform_result = await self._run_agent_phase(
            "terraform",
            extra_args=["--user-id", self.context.user_id],
            extra_env=aws_env,
        )
        if not terraform_result or not terraform_result.get("success"):
            return await self._terminate("Terraform generation and planning failed")

        logger.info("Terraform plan succeeded")
        self._check_cancelled()

        await self._send_status(StreamStatus.costing)
        logger.info("Estimating costs")

        cost_estimate = await asyncio.to_thread(estimate_cost)
        cost_data = cost_estimate_to_dict(cost_estimate)

        cost_table = await asyncio.to_thread(get_cost_table)
        cost_data["table"] = cost_table
        logger.info("Infracost table output:\n%s", cost_table)

        await self._try_send({
            "type": "cost_estimate",
            "data": cost_data,
        })

        logger.info("Waiting for user to confirm deployment")
        self._deploy_confirmed_event.clear()
        await self._deploy_confirmed_event.wait()
        self._check_cancelled()

        if not self._deploy_confirmed:
            logger.info("User cancelled deployment — cleaning up volumes")
            self._user_cancelled = True
            await asyncio.to_thread(self._clear_volumes)
            return False

        # Phase 4: Terraform Apply
        logger.info("User confirmed, starting Terraform apply")

        apply_result = await self._run_agent_phase(
            "terraform_apply",
            extra_args=["--user-id", self.context.user_id],
            extra_env=aws_env,
        )
        if not apply_result or not apply_result.get("success"):
            return await self._terminate("Terraform apply failed")

        logger.info("Terraform provisioning completed successfully")
        await self._send_result({"success": True, "phase": "complete"})

        return True

    async def _check_mcp_connectivity(self) -> bool:
        """Check if the Terraform MCP server is reachable (Section 5.6)."""
        try:
            exit_code, output = await asyncio.to_thread(
                self._container.exec_run,
                ["sh", "-c", "curl -s --max-time 5 --connect-timeout 3 -o /dev/null -X POST http://terraform-mcp:8080/mcp && echo ok || echo fail"],
                user="agent",
            )
            text = decode_output(output).strip()
            if "ok" in text:
                logger.info("Terraform MCP server is reachable")
                return True
            logger.warning(f"Terraform MCP server health check returned: {text}")
            return False
        except Exception as e:
            logger.warning(f"MCP connectivity check failed: {e}")
            return False

    async def _run_agent_phase(self, phase: str, extra_args: list[str] | None = None, extra_env: dict | None = None) -> dict | None:
        cmd = [
            "python", "-m", "pipeline",
            "--phase", phase,
            "--project-name", self.context.project_name,
            "--project-id", self.project_id,
        ]
        if extra_args:
            cmd.extend(extra_args)

        msg_q: thread_queue.Queue = thread_queue.Queue()

        environment = {
            "HOME": "/home/agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        }
        if extra_env:
            environment.update(extra_env)

        def _read_exec_output():
            buffer = ""
            try:
                _, output = self._container.exec_run(
                    cmd, stream=True, workdir="/app", user="agent",
                    environment=environment,
                )
                for chunk in output:
                    buffer += chunk.decode(errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            parsed = json.loads(line)
                            msg_q.put(parsed)
                        except json.JSONDecodeError:
                            msg_q.put({"type": "error", "content": line})
                if buffer.strip():
                    try:
                        parsed = json.loads(buffer.strip())
                        msg_q.put(parsed)
                    except json.JSONDecodeError:
                        msg_q.put({"type": "error", "content": buffer.strip()})
            except Exception as e:
                logger.debug("Exec stream ended: %s", e)
            finally:
                msg_q.put(None)

        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, _read_exec_output)

        result = None
        while True:
            msg = await asyncio.to_thread(msg_q.get)
            if msg is None:
                break
            if self._cancelled:
                break
            if msg.get("type") == "result":
                result = msg.get("data")
            elif msg.get("type") == "questions":
                await self._try_send({"type": "questions", "data": msg.get("data")})
            else:
                # Log non-critical messages to terminal only
                msg_type = msg.get("type", "info")
                msg_content = msg.get("content", "")
                if msg_type == "error":
                    # Only send errors to frontend
                    logger.error(msg_content)
                    await self._send_message("error", msg_content)
                else:
                    # All other messages (phase, success, debug, info) go to backend logs only
                    logger.info(f"[{msg_type.upper()}] {msg_content}")

        return result

    def _clear_volumes(self):
        """Clear contents of both codebase and deploy volumes."""
        try:
            self._container.exec_run(
                [
                    "sh", "-c",
                    "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* "
                    "/workspace/deploy/* /workspace/deploy/.[!.]* /workspace/deploy/..?* 2>/dev/null || true"
                ],
                user="agent",
            )
            logger.info("Volumes cleared")
        except Exception as e:
            logger.error("Failed to clear volumes: %s", e)

    def _setup_terraform_directories(self):
        """Create terraform directories in the deploy volume."""
        try:
            self._container.exec_run(
                [
                    "sh", "-c",
                    "mkdir -p /workspace/deploy/terraform/code /workspace/deploy/terraform/cost"
                ],
                user="agent",
            )
            logger.info("Terraform directories created")
        except Exception as e:
            logger.error("Failed to create terraform directories: %s", e)
            raise

    def _copy_codebase_to_volume(self) -> tuple[bool, str]:
        """Copy codebase from host into Docker Codebase volume. Returns (success, error_msg)."""
        try:
            user_id = self.context.user_id
            project_id = self.project_id

            host_base = os.environ.get("HOST_PROJECTS_DIR")
            if host_base:
                check_path = os.path.join("/local-projects", user_id, project_id)
                host_path = os.path.join(host_base, user_id, project_id)
            else:
                host_path = os.path.abspath(
                    os.path.join(
                        os.path.dirname(__file__), "..", "Connector", "tmp",
                        "local-projects", user_id, project_id,
                    )
                )
                check_path = host_path

            if not os.path.isdir(check_path):
                return (False, f"Codebase directory not found at {check_path}")

            logger.info(f"Copying codebase from {host_path} to Docker volume")

            # Clear codebase first to avoid conflicts
            self._container.exec_run(
                ["sh", "-c", "rm -rf /workspace/codebase/* /workspace/codebase/.[!.]* /workspace/codebase/..?* 2>/dev/null || true"],
                user="agent",
            )

            try:
                # Copy using cp -a through Docker (same approach as Security)
                output = get_docker_client().containers.run(
                    "alpine",
                    command=["sh", "-c", "cp -a /src/. /workspace/codebase/ && echo Success || echo Failed"],
                    volumes={
                        CODEBASE_VOLUME: {"bind": "/workspace/codebase", "mode": "rw"},
                        host_path: {"bind": "/src", "mode": "ro"},
                    },
                    remove=True,
                )

                decoded = decode_output(output)
                if "Success" in decoded:
                    logger.info(f"Codebase copied to Docker volume successfully")
                    return (True, "")
                return (False, f"Copy failed: {decoded}")
            except Exception as e:
                return (False, str(e))

        except Exception as e:
            return (False, str(e))

