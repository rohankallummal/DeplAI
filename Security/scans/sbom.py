from utils import sanitize_name, run_container_sync, CODEBASE_VOLUME, SECURITY_REPORTS_VOLUME


def run_syft_scan(project_name: str, project_id: str) -> tuple[bool, str]:
    sbom_filename = f"{sanitize_name(project_name)}_{project_id}_sbom.json"
    return run_container_sync(
        "anchore/syft",
        command=["dir:/src", "-o", f"json=/repo/{sbom_filename}"],
        volumes={
            CODEBASE_VOLUME: {"bind": "/src", "mode": "ro"},
            SECURITY_REPORTS_VOLUME: {"bind": "/repo", "mode": "rw"},
        },
    )


def run_grype_scan(project_name: str, project_id: str) -> tuple[bool, str]:
    safe_name = sanitize_name(project_name)
    sbom_filename = f"{safe_name}_{project_id}_sbom.json"
    grype_filename = f"{safe_name}_{project_id}_Grype.json"
    return run_container_sync(
        "anchore/grype",
        command=[f"sbom:/repo/{sbom_filename}", "-o", f"json=/repo/{grype_filename}"],
        volumes={
            SECURITY_REPORTS_VOLUME: {"bind": "/repo", "mode": "rw"},
        },
        accept_exit_codes={0, 1},
    )
