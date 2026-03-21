from utils import sanitize_name, run_container_sync, CODEBASE_VOLUME, SECURITY_REPORTS_VOLUME


def run_bearer_scan(project_name: str, project_id: str) -> tuple[bool, str]:
    filename = f"{sanitize_name(project_name)}_{project_id}_Bearer.json"
    return run_container_sync(
        "bearer/bearer:latest-amd64",
        command=["scan", "/tmp/scan", "--format", "json", "--output", f"/output/{filename}"],
        volumes={
            CODEBASE_VOLUME: {"bind": "/tmp/scan", "mode": "rw"},
            SECURITY_REPORTS_VOLUME: {"bind": "/output", "mode": "rw"},
        },
        accept_exit_codes={0, 1},
        user="0:0",
    )
