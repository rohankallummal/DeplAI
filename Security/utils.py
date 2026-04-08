import os
import re

import docker

_docker_client: docker.DockerClient | None = None

SEVERITY_LEVELS = ["critical", "high", "medium", "low"]
SCANNER_SUFFIXES = ["Bearer.json", "sbom.json", "Grype.json"]

CODEBASE_VOLUME = "securityCode"
SECURITY_REPORTS_VOLUME = "Reports"
AGENT_ARTIFACTS_VOLUME = "Artifact"

PIPELINE_IMAGE = "deplai-security"
REMEDIATION_CONTAINER_NAME = "remediation"

SCAN_VOLUME_NAMES = [CODEBASE_VOLUME, SECURITY_REPORTS_VOLUME]
ALL_VOLUME_NAMES = [CODEBASE_VOLUME, SECURITY_REPORTS_VOLUME, AGENT_ARTIFACTS_VOLUME]


def get_docker_client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env()
    return _docker_client


def sanitize_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


def decode_output(output: bytes | str) -> str:
    return output.decode() if isinstance(output, bytes) else str(output)


def read_volume_file(filename: str) -> str | None:
    try:
        output = get_docker_client().containers.run(
            "alpine",
            command=["cat", f"/vol/{filename}"],
            volumes={SECURITY_REPORTS_VOLUME: {"bind": "/vol", "mode": "ro"}},
            remove=True,
        )
        return decode_output(output)
    except Exception:
        return None


def find_volume_file(project_id: str, suffix: str) -> str | None:
    try:
        output = get_docker_client().containers.run(
            "alpine",
            command=["sh", "-c", f"ls /vol/*_{project_id}_{suffix} 2>/dev/null"],
            volumes={SECURITY_REPORTS_VOLUME: {"bind": "/vol", "mode": "ro"}},
            remove=True,
        )
        result = decode_output(output).strip()
        if result:
            return result.split("\n")[0].replace("/vol/", "")
        return None
    except Exception:
        return None


def run_container_sync(
    image: str,
    command: list[str],
    volumes: dict,
    accept_exit_codes: set[int] = frozenset({0}),
    **kwargs,
) -> tuple[bool, str]:
    try:
        container = get_docker_client().containers.run(
            image, command=command, volumes=volumes, detach=True, **kwargs,
        )
        result = container.wait()
        container.remove()
        exit_code = result.get("StatusCode", -1)
        if exit_code in accept_exit_codes:
            return (True, "")
        return (False, f"{image.split('/')[-1]} exited with code {exit_code}")
    except Exception as e:
        return (False, str(e))


def get_or_create_remediation_container():
    client = get_docker_client()

    try:
        container = client.containers.get(REMEDIATION_CONTAINER_NAME)
        if container.status == "running":
            return container
        container.start()
        return container
    except docker.errors.NotFound:
        pass
    except Exception:
        remove_remediation_container()

    try:
        client.volumes.create(name=AGENT_ARTIFACTS_VOLUME)
    except Exception:
        pass

    return client.containers.run(
        PIPELINE_IMAGE,
        command=["sleep", "infinity"],
        name=REMEDIATION_CONTAINER_NAME,
        volumes={
            "/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"},
            CODEBASE_VOLUME: {"bind": "/codebase", "mode": "rw"},
            SECURITY_REPORTS_VOLUME: {"bind": "/security_reports", "mode": "ro"},
            AGENT_ARTIFACTS_VOLUME: {"bind": "/workspace", "mode": "rw"},
        },
        environment={
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        },
        detach=True,
    )


def remove_remediation_container() -> None:
    try:
        container = get_docker_client().containers.get(REMEDIATION_CONTAINER_NAME)
        container.stop(timeout=5)
        container.remove(force=True)
    except docker.errors.NotFound:
        pass
    except Exception:
        pass


def clear_agent_artifacts() -> None:
    client = get_docker_client()

    try:
        container = client.containers.get(REMEDIATION_CONTAINER_NAME)
        if container.status == "running":
            container.exec_run(
                ["sh", "-c", "rm -rf /workspace/* /workspace/.[!.]* /workspace/..?*"],
            )
            return
    except Exception:
        pass

    try:
        client.containers.run(
            "alpine",
            command=["sh", "-c", "rm -rf /vol/* /vol/.[!.]* /vol/..?*"],
            volumes={AGENT_ARTIFACTS_VOLUME: {"bind": "/vol", "mode": "rw"}},
            remove=True,
        )
    except Exception:
        pass
