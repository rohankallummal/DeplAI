import logging
import os
import time

import docker

logger = logging.getLogger(__name__)

CUSTOMIZE_CODE_VOLUME = "customizeCode"
CUSTOMIZE_WORK_VOLUME = "CustomizeWork"

PIPELINE_IMAGE = "deplai-customize"
CUSTOMIZE_CONTAINER_NAME = "customize-agent"

ALL_VOLUME_NAMES = [CUSTOMIZE_CODE_VOLUME, CUSTOMIZE_WORK_VOLUME]

_docker_client: docker.DockerClient | None = None


def get_docker_client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        # No socket timeout — let long-running Docker operations
        # (container.wait, large copies) finish at their own pace.
        _docker_client = docker.from_env(timeout=None)
    return _docker_client


def decode_output(output: bytes | str) -> str:
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace")
    return str(output)


def read_volume_file(filename: str, volume: str = CUSTOMIZE_WORK_VOLUME) -> str | None:
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


def get_or_create_customize_container():
    client = get_docker_client()

    try:
        container = client.containers.get(CUSTOMIZE_CONTAINER_NAME)
        if container.status != "running":
            container.start()
        return container
    except docker.errors.NotFound:
        pass

    for vol_name in ALL_VOLUME_NAMES:
        try:
            client.volumes.create(name=vol_name)
        except docker.errors.APIError:
            pass

    container = client.containers.run(
        PIPELINE_IMAGE,
        command=["sleep", "infinity"],
        name=CUSTOMIZE_CONTAINER_NAME,
        user="agent",
        volumes={
            "/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"},
            CUSTOMIZE_CODE_VOLUME: {"bind": "/workspace/codebase", "mode": "rw"},
            CUSTOMIZE_WORK_VOLUME: {"bind": "/workspace/customize", "mode": "rw"},
        },
        environment={
            "HOME": "/home/agent",
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
        },
        network="customization_deplai",
        detach=True,
    )
    return container


def remove_customize_container():
    try:
        container = get_docker_client().containers.get(CUSTOMIZE_CONTAINER_NAME)
        container.remove(force=True)
    except docker.errors.NotFound:
        pass
    except Exception as e:
        logger.warning("Failed to remove customize container: %s", e)


def clear_customize_artifacts():
    try:
        container = get_docker_client().containers.get(CUSTOMIZE_CONTAINER_NAME)
        container.exec_run(
            [
                "sh", "-c",
                "rm -rf /workspace/customize/* /workspace/customize/.[!.]* /workspace/customize/..?* 2>/dev/null || true",
            ],
            user="agent",
        )
    except Exception:
        try:
            get_docker_client().containers.run(
                "alpine",
                command=["sh", "-c", "rm -rf /vol/* /vol/.[!.]* /vol/..?* 2>/dev/null || true"],
                volumes={CUSTOMIZE_WORK_VOLUME: {"bind": "/vol", "mode": "rw"}},
                remove=True,
            )
        except Exception as e:
            logger.error("Failed to clear customize artifacts: %s", e)


def _remove_containers_using_volume(client: docker.DockerClient, vol_name: str):
    """Force-remove any containers still referencing a volume."""
    try:
        for container in client.containers.list(all=True, filters={"volume": vol_name}):
            try:
                container.remove(force=True)
                logger.info("Removed stale container %s holding volume %s", container.name, vol_name)
            except Exception:
                pass
    except Exception:
        pass


def cleanup_volumes() -> tuple[bool, str]:
    client = get_docker_client()
    errors = []
    for vol_name in ALL_VOLUME_NAMES:
        _remove_containers_using_volume(client, vol_name)
        last_err = None
        for attempt in range(3):
            try:
                vol = client.volumes.get(vol_name)
                vol.remove(force=True)
                last_err = None
                break
            except docker.errors.NotFound:
                last_err = None
                break
            except Exception as e:
                last_err = e
                if attempt < 2:
                    time.sleep(1)
        if last_err is not None:
            errors.append(f"{vol_name}: {last_err}")
    if errors:
        return (False, "; ".join(errors))
    return (True, "")
