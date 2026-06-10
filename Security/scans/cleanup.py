import logging
import time

import docker

from utils import get_docker_client, SCANNER_SUFFIXES, ALL_VOLUME_NAMES, SECURITY_REPORTS_VOLUME

logger = logging.getLogger(__name__)

VOLUME_REMOVE_RETRIES = 3
VOLUME_REMOVE_RETRY_DELAY = 0.5


def cleanup_project_reports(project_id: str) -> tuple[bool, str]:
    try:
        patterns = " ".join(f"/vol/*_{project_id}_{s}" for s in SCANNER_SUFFIXES)
        get_docker_client().containers.run(
            "alpine",
            command=["sh", "-c", f"rm -f {patterns}"],
            volumes={SECURITY_REPORTS_VOLUME: {"bind": "/vol", "mode": "rw"}},
            remove=True,
        )
        return (True, "")
    except docker.errors.NotFound:
        return (True, "")
    except Exception as e:
        return (False, str(e))


def _stop_containers_using_volumes(client: docker.DockerClient) -> None:
    volume_set = set(ALL_VOLUME_NAMES)
    try:
        for container in client.containers.list(all=True):
            try:
                mounts = container.attrs.get("Mounts", [])
                if any(m.get("Name") in volume_set for m in mounts):
                    logger.info("Stopping container %s using managed volume", container.short_id)
                    container.remove(force=True)
            except Exception as e:
                logger.debug("Could not remove container %s: %s", container.short_id, e)
    except Exception as e:
        logger.debug("Could not list containers for cleanup: %s", e)


def _remove_volume_with_retry(client: docker.DockerClient, name: str) -> str | None:
    last_error: Exception | None = None
    for attempt in range(VOLUME_REMOVE_RETRIES):
        try:
            client.volumes.get(name).remove(force=True)
            return None
        except docker.errors.NotFound:
            return None
        except docker.errors.APIError as e:
            last_error = e
            if "volume is in use" in str(e) and attempt < VOLUME_REMOVE_RETRIES - 1:
                _stop_containers_using_volumes(client)
                time.sleep(VOLUME_REMOVE_RETRY_DELAY)
                continue
            break
        except Exception as e:
            last_error = e
            break
    logger.error("Failed to remove volume %s: %s", name, last_error)
    return f"{name}: {last_error}"


def cleanup_volumes() -> tuple[bool, str]:
    client = get_docker_client()
    errors: list[str] = []

    _stop_containers_using_volumes(client)

    for name in ALL_VOLUME_NAMES:
        err = _remove_volume_with_retry(client, name)
        if err:
            errors.append(err)

    if errors:
        return (False, "; ".join(errors))
    return (True, "")
