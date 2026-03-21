import logging

import docker

from utils import get_docker_client, SCANNER_SUFFIXES, ALL_VOLUME_NAMES, SECURITY_REPORTS_VOLUME

logger = logging.getLogger(__name__)


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


def cleanup_volumes() -> tuple[bool, str]:
    client = get_docker_client()
    errors: list[str] = []

    _stop_containers_using_volumes(client)

    for name in ALL_VOLUME_NAMES:
        try:
            client.volumes.get(name).remove(force=True)
        except docker.errors.NotFound:
            pass
        except Exception as e:
            logger.error("Failed to remove volume %s: %s", name, e)
            errors.append(f"{name}: {e}")

    if errors:
        return (False, "; ".join(errors))
    return (True, "")
