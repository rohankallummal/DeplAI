import logging
import os
import time

import docker

logger = logging.getLogger(__name__)

CUSTOMIZE_CODE_VOLUME = "customizeCode"

PIPELINE_IMAGE = "deplai-customize"
CUSTOMIZE_CONTAINER_NAME = "customize-agent"

# Live Preview: a dedicated container + volume + nginx gateway, separate from the
# customize working tree so the preview always reflects persisted state. The
# preview container reuses the deplai-customize image (Node + Claude + Python).
PREVIEW_IMAGE = PIPELINE_IMAGE
PREVIEW_CONTAINER_NAME = "customize-preview"
PREVIEW_GATEWAY_NAME = "live-preview-gateway"
PREVIEW_CODE_VOLUME = "LivePreview"
PREVIEW_NETWORK = "customization_deplai"
PREVIEW_HOST_PORT = 8090

ALL_VOLUME_NAMES = [CUSTOMIZE_CODE_VOLUME]

_docker_client: docker.DockerClient | None = None


def get_docker_client() -> docker.DockerClient:
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.from_env(timeout=None)
    return _docker_client


def decode_output(output: bytes | str) -> str:
    if isinstance(output, bytes):
        return output.decode("utf-8", errors="replace")
    return str(output)


def local_project_host_path(user_id: str, project_id: str) -> tuple[str, str]:
    """Resolve (host_path, check_path) for a local project's files.

    host_path is what gets bind-mounted into helper containers; check_path is
    where this process verifies existence. They differ only when
    HOST_PROJECTS_DIR maps the host directory to /local-projects inside the
    service container. Single source of truth for runner/publish/preview."""
    host_base = os.environ.get("HOST_PROJECTS_DIR")
    if host_base:
        return (
            os.path.join(host_base, user_id, project_id),
            os.path.join("/local-projects", user_id, project_id),
        )
    path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "Connector", "tmp", "local-projects", user_id, project_id)
    )
    return (path, path)


def run_and_cleanup(**run_kwargs) -> tuple[dict, str]:
    """Run a throwaway container to completion and remove it, returning
    (wait_result, logs). Shared by every short-lived helper container
    (copy / clone / save / push)."""
    container = get_docker_client().containers.run(detach=True, **run_kwargs)
    try:
        result = container.wait()
        logs = decode_output(container.logs())
    finally:
        try:
            container.remove(force=True)
        except Exception:
            pass
    return result, logs


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
            CUSTOMIZE_CODE_VOLUME: {"bind": "/workspace", "mode": "rw"},
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


def _remove_container_by_name(name: str):
    try:
        container = get_docker_client().containers.get(name)
        container.remove(force=True)
    except docker.errors.NotFound:
        pass
    except Exception as e:
        logger.warning("Failed to remove container %s: %s", name, e)


def remove_preview_container():
    _remove_container_by_name(PREVIEW_CONTAINER_NAME)


def remove_preview_gateway():
    _remove_container_by_name(PREVIEW_GATEWAY_NAME)


def remove_preview_volume() -> tuple[bool, str]:
    """Remove the LivePreview volume, first clearing any container still holding
    it (the preview container is normally gone by now, but be defensive). Mirrors
    the retry behavior of cleanup_volumes for Docker Desktop flakiness."""
    client = get_docker_client()
    _remove_containers_using_volume(client, PREVIEW_CODE_VOLUME)
    last_err = None
    for attempt in range(3):
        try:
            client.volumes.get(PREVIEW_CODE_VOLUME).remove(force=True)
            return (True, "")
        except docker.errors.NotFound:
            return (True, "")
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(1)
    return (False, str(last_err))


def _remove_containers_using_volume(client: docker.DockerClient, vol_name: str):
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
