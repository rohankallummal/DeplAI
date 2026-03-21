#!/usr/bin/env python3

import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import get_docker_client, run_container_sync, CODEBASE_VOLUME, AGENT_ARTIFACTS_VOLUME

ARTIFACT_VOLUMES = {AGENT_ARTIFACTS_VOLUME: {"bind": "/vol", "mode": "rw"}}


def _ensure_cycle_dir(cycle_num: int) -> str:
    cycle_dir = f"security/cycle{cycle_num}"
    get_docker_client().containers.run(
        "alpine",
        command=["mkdir", "-p", f"/vol/{cycle_dir}"],
        volumes=ARTIFACT_VOLUMES,
        remove=True,
    )
    return cycle_dir


def run_cycle_bearer(project_name: str, project_id: str, cycle_num: int) -> tuple[bool, str]:
    cycle_dir = _ensure_cycle_dir(cycle_num)
    output_path = f"/vol/{cycle_dir}/bearer.json"

    success, err = run_container_sync(
        "bearer/bearer:latest-amd64",
        command=["scan", "/tmp/scan", "--format", "json", "--output", output_path],
        volumes={CODEBASE_VOLUME: {"bind": "/tmp/scan", "mode": "rw"}, **ARTIFACT_VOLUMES},
        accept_exit_codes={0, 1},
        user="0:0",
    )

    if success:
        get_docker_client().containers.run(
            "alpine",
            command=["sh", "-c", f"[ -f {output_path} ] || echo '{{}}' > {output_path}"],
            volumes=ARTIFACT_VOLUMES,
            remove=True,
        )

    return (success, err)


def run_cycle_grype(project_name: str, project_id: str, cycle_num: int) -> tuple[bool, str]:
    cycle_dir = _ensure_cycle_dir(cycle_num)

    success, err = run_container_sync(
        "anchore/syft",
        command=["dir:/src", "-o", f"json=/vol/{cycle_dir}/sbom.json"],
        volumes={CODEBASE_VOLUME: {"bind": "/src", "mode": "ro"}, **ARTIFACT_VOLUMES},
    )
    if not success:
        return (False, f"Syft failed: {err}")

    return run_container_sync(
        "anchore/grype",
        command=[f"sbom:/vol/{cycle_dir}/sbom.json", "-o", f"json=/vol/{cycle_dir}/grype.json"],
        volumes=ARTIFACT_VOLUMES,
        accept_exit_codes={0, 1},
    )


def run_all_scanners(project_name: str, project_id: str, cycle_num: int) -> bool:
    print(f"[*] Running Bearer scan for cycle {cycle_num}...")
    ok_bearer, err_bearer = run_cycle_bearer(project_name, project_id, cycle_num)
    if ok_bearer:
        print("[+] Bearer scan completed successfully")
    else:
        print(f"[!] Bearer scan failed: {err_bearer}")

    print(f"[*] Running Syft + Grype scan for cycle {cycle_num}...")
    ok_grype, err_grype = run_cycle_grype(project_name, project_id, cycle_num)
    if ok_grype:
        print("[+] Grype scan completed successfully")
    else:
        print(f"[!] Grype scan failed: {err_grype}")

    if ok_bearer or ok_grype:
        print(f"[+] Scanners completed for cycle {cycle_num}")
        return True

    print(f"[ERR] All scanners failed for cycle {cycle_num}")
    return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Security scanner tool for remediation cycles",
    )
    sub = parser.add_subparsers(dest="command")

    scan_p = sub.add_parser("run-scanners", help="Run Bearer + Grype scanners")
    scan_p.add_argument("--project-name", required=True)
    scan_p.add_argument("--project-id", required=True)
    scan_p.add_argument("--cycle", type=int, required=True)

    args = parser.parse_args()

    if args.command == "run-scanners":
        success = run_all_scanners(args.project_name, args.project_id, args.cycle)
        sys.exit(0 if success else 1)
    else:
        parser.print_help()
        sys.exit(1)
