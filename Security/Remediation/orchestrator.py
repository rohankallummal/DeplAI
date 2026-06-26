import glob
import json
import logging
import os
import re
from typing import Callable, Awaitable

from Remediation.agents import context_builder, executor
from scans.result_parser import _parse_bearer_report, _parse_grype_report

logger = logging.getLogger(__name__)

CODEBASE_PATH = "/codebase"
WORKSPACE_PATH = "/workspace"
SECURITY_REPORTS_PATH = "/security_reports"


def _read_file(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return None


def _safe_parse(fn, raw: str | None) -> list:
    if not raw:
        return []
    try:
        return fn(raw)
    except Exception as e:
        logger.warning("Failed to parse report: %s", e)
        return []


def _parse_reports(bearer_raw: str | None, grype_raw: str | None) -> dict:
    return {
        "supply_chain": _safe_parse(_parse_grype_report, grype_raw),
        "code_security": _safe_parse(lambda r: _parse_bearer_report(r, include_docs=False), bearer_raw),
    }


class Orchestrator:

    def __init__(
        self,
        project_name: str,
        project_id: str,
        on_message: Callable[[str, str], Awaitable[None]],
    ):
        self.project_name = project_name
        self.project_id = project_id
        self.on_message = on_message

    async def run(self) -> dict:
        await self.on_message("phase", "Initializing remediation pipeline")
        self._prepare_workspace()

        await self.on_message("info", "Loading scan reports")
        scan_data = self._load_initial_scan_data()
        if scan_data is None:
            await self.on_message("error", "No scan reports found. Run a scan first.")
            return {"status": "failed", "success": False, "message": "No scan reports found", "cycles_run": 0}

        self._write_json("scan_data.json", scan_data)
        await self.on_message("success", "Scan reports loaded")

        await self.on_message("phase", "Building codebase context")
        if not await context_builder.run(CODEBASE_PATH, WORKSPACE_PATH):
            await self.on_message("error", "Context builder failed")
            return {"status": "failed", "success": False, "message": "Context builder failed", "cycles_run": 0}
        await self.on_message("success", "Codebase context ready")

        await self.on_message("phase", "Remediating codebase")
        if not await executor.run(
            CODEBASE_PATH,
            WORKSPACE_PATH,
            project_name=self.project_name,
            project_id=self.project_id,
        ):
            await self.on_message("error", "Executor failed")
            return {"status": "failed", "success": False, "message": "Executor failed", "cycles_run": 0}
        await self.on_message("success", "Executor complete")

        final_cycle, final_scan_data, bearer_present, grype_present = self._read_latest_cycle_scan_data()
        total_remaining = len(self._extract_vuln_ids(final_scan_data))
        cycles_run = max(final_cycle, 1)
        status = self._classify(final_scan_data, bearer_present, grype_present)

        if status == "remediated":
            msg = f"All vulnerabilities resolved after {cycles_run} cycle(s)"
            await self.on_message("success", msg)
            return {"status": status, "success": True,
                    "message": "All vulnerabilities resolved", "cycles_run": cycles_run}

        if status == "partially_remediated":
            msg = f"Remediation completed with {total_remaining} remaining supply-chain vulnerability(ies) after {cycles_run} cycle(s)"
            await self.on_message("warning", msg)
            return {"status": status, "success": True,
                    "message": "Remediation completed with remaining vulnerabilities", "cycles_run": cycles_run}

        msg = f"{total_remaining} vulnerabilities remain after {cycles_run} cycle(s)"
        await self.on_message("warning", msg)
        return {"status": "failed", "success": False, "message": msg, "cycles_run": cycles_run}

    def _prepare_workspace(self):
        for subdir in ("", "security", "Knowledge-Store"):
            os.makedirs(os.path.join(WORKSPACE_PATH, subdir), exist_ok=True)

    def _load_initial_scan_data(self) -> dict | None:
        bearer_files = glob.glob(os.path.join(SECURITY_REPORTS_PATH, f"*_{self.project_id}_Bearer.json"))
        grype_files = glob.glob(os.path.join(SECURITY_REPORTS_PATH, f"*_{self.project_id}_Grype.json"))

        bearer_raw = _read_file(bearer_files[0]) if bearer_files else None
        grype_raw = _read_file(grype_files[0]) if grype_files else None

        if bearer_raw is None and grype_raw is None:
            return None
        return _parse_reports(bearer_raw, grype_raw)

    def _write_json(self, filename: str, data: dict):
        with open(os.path.join(WORKSPACE_PATH, filename), "w") as f:
            json.dump(data, f, indent=2)

    @staticmethod
    def _extract_vuln_ids(scan_data: dict) -> set[str]:
        ids: set[str] = set()
        for item in scan_data.get("supply_chain", []):
            if item.get("cve_id"):
                ids.add(item["cve_id"])
        for group in scan_data.get("code_security", []):
            if group.get("cwe_id"):
                ids.add(group["cwe_id"])
        return ids

    @staticmethod
    def _classify(scan_data: dict, bearer_present: bool, grype_present: bool) -> str:
        # The success signal hinges on the final-cycle code scan. If that output is
        # missing (scanner crashed, or no cycle ran) we cannot assert the code
        # vulnerabilities were fixed — report failed rather than a false all-clear.
        if not bearer_present:
            return "failed"
        remaining_supply = sum(1 for x in scan_data.get("supply_chain", []) if x.get("cve_id"))
        remaining_code = sum(1 for g in scan_data.get("code_security", []) if g.get("cwe_id"))
        if remaining_supply == 0 and remaining_code == 0 and grype_present:
            return "remediated"
        if remaining_code == 0:
            return "partially_remediated"
        return "failed"

    def _read_latest_cycle_scan_data(self) -> tuple[int, dict, bool, bool]:
        security_dir = os.path.join(WORKSPACE_PATH, "security")
        empty: dict = {"supply_chain": [], "code_security": []}
        if not os.path.isdir(security_dir):
            return (0, empty, False, False)

        cycle_nums = [
            int(m.group(1))
            for name in os.listdir(security_dir)
            if (m := re.fullmatch(r"cycle(\d+)", name))
        ]
        if not cycle_nums:
            return (0, empty, False, False)

        latest = max(cycle_nums)
        cycle_dir = os.path.join(security_dir, f"cycle{latest}")
        bearer_raw = _read_file(os.path.join(cycle_dir, "bearer.json"))
        grype_raw = _read_file(os.path.join(cycle_dir, "grype.json"))
        # Report presence so _classify can distinguish "scanner found nothing" from
        # "scanner output missing" (a crashed/absent scan must not read as clean).
        return (latest, _parse_reports(bearer_raw, grype_raw), bearer_raw is not None, grype_raw is not None)
