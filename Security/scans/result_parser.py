import json
import threading

import docker

from utils import SEVERITY_LEVELS, read_volume_file, find_volume_file, get_docker_client, SECURITY_REPORTS_VOLUME

_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()


def _parse_bearer_report(raw: str, include_docs: bool = True) -> list[dict]:
    raw = raw.strip()
    if not raw or not raw.startswith("{"):
        return []
    data = json.loads(raw)

    cwe_groups: dict[tuple[str, str], dict] = {}

    for severity in SEVERITY_LEVELS:
        for item in data.get(severity, []):
            cwe_ids = item.get("cwe_ids", [])
            cwe_id = cwe_ids[0] if cwe_ids else "unknown"
            key = (cwe_id, severity)

            if key not in cwe_groups:
                cwe_groups[key] = {
                    "cwe_id": cwe_id,
                    "title": item.get("title", ""),
                    "severity": severity,
                    "occurrences": [],
                }

            occurrence = {
                "filename": item.get("filename", ""),
                "line_number": item.get("line_number", 0),
                "code_extract": item.get("code_extract", ""),
            }
            if include_docs:
                occurrence["documentation_url"] = item.get("documentation_url", "")

            cwe_groups[key]["occurrences"].append(occurrence)

    severity_order = {s: i for i, s in enumerate(SEVERITY_LEVELS)}
    for group in cwe_groups.values():
        group["count"] = len(group["occurrences"])

    return sorted(
        cwe_groups.values(),
        key=lambda g: (severity_order.get(g["severity"], 99), -g["count"]),
    )


def _parse_grype_report(raw: str) -> list[dict]:
    data = json.loads(raw)

    vulnerabilities = []
    for match in data.get("matches", []):
        vuln = match.get("vulnerability", {})
        artifact = match.get("artifact", {})
        epss_list = vuln.get("epss", [])
        fix_versions = vuln.get("fix", {}).get("versions", [])

        vulnerabilities.append({
            "name": artifact.get("name", ""),
            "type": artifact.get("type", ""),
            "version": artifact.get("version", ""),
            "purl": artifact.get("purl"),
            "severity": vuln.get("severity", "Unknown"),
            "epss_score": epss_list[0].get("epss") if epss_list else None,
            "fix_version": fix_versions[0] if fix_versions else None,
            "cve_id": vuln.get("id", ""),
        })

    return vulnerabilities


def _read_reports(project_id: str, include_docs: bool = True, strict: bool = True) -> tuple[bool, dict | str]:
    bearer_file = find_volume_file(project_id, "Bearer.json")
    grype_file = find_volume_file(project_id, "Grype.json")

    bearer_raw = read_volume_file(bearer_file) if bearer_file else None
    grype_raw = read_volume_file(grype_file) if grype_file else None

    if bearer_raw is None and grype_raw is None:
        return (False, "No scan reports found. Run a scan first.")

    code_security = []
    if bearer_raw:
        try:
            code_security = _parse_bearer_report(bearer_raw, include_docs=include_docs)
        except Exception as e:
            if strict:
                return (False, f"Failed to parse Bearer report: {e}")

    supply_chain = []
    if grype_raw:
        try:
            supply_chain = _parse_grype_report(grype_raw)
        except Exception as e:
            if strict:
                return (False, f"Failed to parse Grype report: {e}")

    return (True, {"supply_chain": supply_chain, "code_security": code_security})


def _load_and_cache(project_id: str) -> tuple[bool, dict | str]:
    try:
        get_docker_client().volumes.get(SECURITY_REPORTS_VOLUME)
    except docker.errors.NotFound:
        return (False, "No scan reports found. Run a scan first.")

    success, result = _read_reports(project_id, include_docs=True, strict=True)
    if not success:
        return (False, result)

    status = "found" if result["supply_chain"] or result["code_security"] else "not_found"

    with _cache_lock:
        _cache[project_id] = {"status": status, "data": result}

    return (True, result)


def get_scan_results(project_id: str) -> tuple[bool, dict | str]:
    with _cache_lock:
        cached = _cache.get(project_id)
    if cached:
        return (True, cached["data"])
    return _load_and_cache(project_id)


def get_scan_status(project_id: str) -> str:
    with _cache_lock:
        cached = _cache.get(project_id)
    if cached:
        return cached["status"]

    success, _ = _load_and_cache(project_id)
    if not success:
        return "not_initiated"

    with _cache_lock:
        return _cache[project_id]["status"]


def invalidate_cache(project_id: str) -> None:
    with _cache_lock:
        _cache.pop(project_id, None)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def parse_reports_for_agent(project_id: str) -> dict | None:
    success, result = _read_reports(project_id, include_docs=False, strict=False)
    return result if success else None
