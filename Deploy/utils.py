import os
import docker

_docker_client: docker.DockerClient | None = None

CODEBASE_VOLUME = "Codebase"
DEPLOY_VOLUME = "Deploy"

PIPELINE_IMAGE = "deplai-deploy"
DEPLOY_CONTAINER_NAME = "deploy-agent"

ALL_VOLUME_NAMES = [CODEBASE_VOLUME, DEPLOY_VOLUME]


def get_docker_client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def decode_output(output: bytes | str) -> str:
    return output.decode() if isinstance(output, bytes) else str(output)


def read_volume_file(filename: str, volume: str = DEPLOY_VOLUME) -> str | None:
    try:
        output = get_docker_client().containers.run(
            "alpine",
            command=["cat", f"/vol/{filename}"],
            volumes={volume: {"bind": "/vol", "mode": "ro"}},
            remove=True,
        )
        return decode_output(output)
    except Exception:
        return None


def get_or_create_deploy_container():
    client = get_docker_client()

    try:
        container = client.containers.get(DEPLOY_CONTAINER_NAME)
        if container.status == "running":
            return container
        container.start()
        return container
    except docker.errors.NotFound:
        pass
    except Exception:
        remove_deploy_container()

    for vol_name in ALL_VOLUME_NAMES:
        try:
            client.volumes.create(name=vol_name)
        except Exception:
            pass

    return client.containers.run(
        PIPELINE_IMAGE,
        command=["sleep", "infinity"],
        name=DEPLOY_CONTAINER_NAME,
        user="agent",
        volumes={
            "/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"},
            CODEBASE_VOLUME: {"bind": "/workspace/codebase", "mode": "rw"},
            DEPLOY_VOLUME: {"bind": "/workspace/deploy", "mode": "rw"},
        },
        environment={
            "HOME": "/home/agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        },
        network="deploy_deplai",
        detach=True,
    )


def remove_deploy_container() -> None:
    try:
        container = get_docker_client().containers.get(DEPLOY_CONTAINER_NAME)
        container.stop(timeout=5)
        container.remove(force=True)
    except docker.errors.NotFound:
        pass
    except Exception:
        pass


def clear_deploy_artifacts() -> None:
    client = get_docker_client()

    try:
        container = client.containers.get(DEPLOY_CONTAINER_NAME)
        if container.status == "running":
            container.exec_run(
                ["sh", "-c", "rm -rf /workspace/deploy/* /workspace/deploy/.[!.]* /workspace/deploy/..?*"],
            )
            return
    except Exception:
        pass

    try:
        client.containers.run(
            "alpine",
            command=["sh", "-c", "rm -rf /vol/* /vol/.[!.]* /vol/..?*"],
            volumes={DEPLOY_VOLUME: {"bind": "/vol", "mode": "rw"}},
            remove=True,
        )
    except Exception:
        pass


def cleanup_volumes() -> tuple[bool, str]:
    client = get_docker_client()
    errors = []

    for vol_name in ALL_VOLUME_NAMES:
        try:
            vol = client.volumes.get(vol_name)
            vol.remove(force=True)
        except docker.errors.NotFound:
            pass
        except Exception as e:
            errors.append(f"{vol_name}: {e}")

    if errors:
        return (False, "; ".join(errors))
    return (True, "")


def run_terraform_command(tf_command: list[str], aws_env: dict, tf_log: str | None = None) -> tuple[int, str]:
    """Run a terraform command inside the deploy-agent container. Returns (exit_code, output)."""
    try:
        container = get_or_create_deploy_container()

        env = {**aws_env}
        if tf_log:
            env["TF_LOG"] = tf_log

        cmd = ["terraform"] + tf_command
        exit_code, output = container.exec_run(
            cmd,
            workdir="/workspace/deploy/terraform/code",
            environment=env,
            user="agent",
        )
        logs = output.decode(errors="replace") if isinstance(output, bytes) else str(output)
        return (exit_code, logs)
    except Exception as e:
        return (-1, str(e))
