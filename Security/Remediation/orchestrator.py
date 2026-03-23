import glob
import json
import logging
import os
from typing import Callable, Awaitable

from Remediation.agents import context_builder, executor, reviewer, verifier
from scans.result_parser import _parse_bearer_report, _parse_grype_report

logger = logging.getLogger(__name__)

CODEBASE_PATH = "/codebase"
WORKSPACE_PATH = "/workspace"
SECURITY_REPORTS_PATH = "/security_reports"
MAX_CYCLES = 3


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
        self.cycle_history: list[dict] = []

    async def run(self) -> dict:
        await self.on_message("phase", "Initializing remediation pipeline")

        self._prepare_workspace()

        await self.on_message("info", "Loading scan reports")
        scan_data = self._load_initial_scan_data()
        if scan_data is None:
            await self.on_message("error", "No scan reports found. Run a scan first.")
            return {"success": False, "message": "No scan reports found", "cycles_run": 0}

        self._write_json("scan_data.json", scan_data)
        await self.on_message("success", "Scan reports loaded")

        await self.on_message("phase", "Building codebase context")
        if not await context_builder.run(CODEBASE_PATH, WORKSPACE_PATH):
            await self.on_message("error", "Context builder failed")
            return {"success": False, "message": "Context builder failed", "cycles_run": 0}
        await self.on_message("success", "Codebase context ready")

        prev_vuln_ids = self._extract_vuln_ids(scan_data)

        for cycle in range(1, MAX_CYCLES + 1):
            result = await self._run_cycle(cycle, prev_vuln_ids)
            if result is not None:
                return result

            new_scan_data = self._read_cycle_scan_data(cycle)
            new_vuln_ids = self._extract_vuln_ids(new_scan_data)

            self._write_json("scan_data.json", new_scan_data)
            prev_vuln_ids = new_vuln_ids

        return {"success": False, "message": "Unexpected exit", "cycles_run": MAX_CYCLES}

    async def _run_cycle(self, cycle: int, prev_vuln_ids: set[str]) -> dict | None:
        await self.on_message("phase", f"Cycle {cycle}: Starting remediation")

        await self.on_message("info", f"Cycle {cycle}: Executing fixes")
        history_str = self._format_cycle_history() if cycle > 1 else ""
        if not await executor.run(
            CODEBASE_PATH,
            WORKSPACE_PATH,
            cycle_num=cycle,
            cycle_history=history_str,
        ):
            await self.on_message("error", f"Cycle {cycle}: Executor failed")
            return {"success": False, "message": f"Executor failed on cycle {cycle}", "cycles_run": cycle}
        await self.on_message("success", f"Cycle {cycle}: Fixes applied")

        await self.on_message("info", f"Cycle {cycle}: Reviewing changes")
        if not await reviewer.run(CODEBASE_PATH, WORKSPACE_PATH):
            await self.on_message("error", f"Cycle {cycle}: Reviewer failed")
            return {"success": False, "message": f"Reviewer failed on cycle {cycle}", "cycles_run": cycle}
        await self.on_message("success", f"Cycle {cycle}: Review complete")

        await self.on_message("info", f"Cycle {cycle}: Verifying fixes")
        if not await verifier.run(WORKSPACE_PATH, self.project_name, self.project_id, cycle):
            await self.on_message("error", f"Cycle {cycle}: Verifier failed")
            return {"success": False, "message": f"Verifier failed on cycle {cycle}", "cycles_run": cycle}
        await self.on_message("success", f"Cycle {cycle}: Verification complete")

        new_scan_data = self._read_cycle_scan_data(cycle)
        new_vuln_ids = self._extract_vuln_ids(new_scan_data)

        resolved = prev_vuln_ids - new_vuln_ids
        remaining = prev_vuln_ids & new_vuln_ids
        new_vulns = new_vuln_ids - prev_vuln_ids

        self.cycle_history.append({
            "cycle": cycle,
            "resolved": list(resolved),
            "remaining": list(remaining),
            "new_vulns": list(new_vulns),
        })

        total_remaining = len(remaining) + len(new_vulns)

        if total_remaining == 0:
            await self.on_message("success", f"All vulnerabilities resolved after cycle {cycle}!")
            return {"success": True, "message": "All vulnerabilities resolved", "cycles_run": cycle}

        if total_remaining >= len(prev_vuln_ids) and cycle > 1:
            await self.on_message(
                "warning",
                f"No progress detected after cycle {cycle}. {total_remaining} vulnerabilities remain.",
            )
            return {
                "success": False,
                "message": f"No progress after {cycle} cycles. {total_remaining} vulnerabilities remain.",
                "cycles_run": cycle,
            }

        if cycle == MAX_CYCLES:
            await self.on_message(
                "warning",
                f"Maximum {MAX_CYCLES} cycles reached. {total_remaining} vulnerabilities remain.",
            )
            return {
                "success": False,
                "message": f"Max cycles reached. {total_remaining} vulnerabilities remain.",
                "cycles_run": cycle,
            }

        return None

    def _prepare_workspace(self):
        os.makedirs(WORKSPACE_PATH, exist_ok=True)
        os.makedirs(os.path.join(WORKSPACE_PATH, "security"), exist_ok=True)
        os.makedirs(os.path.join(WORKSPACE_PATH, "Knowledge-Store"), exist_ok=True)

    def _load_initial_scan_data(self) -> dict | None:
        bearer_files = glob.glob(
            os.path.join(SECURITY_REPORTS_PATH, f"*_{self.project_id}_Bearer.json")
        )
        grype_files = glob.glob(
            os.path.join(SECURITY_REPORTS_PATH, f"*_{self.project_id}_Grype.json")
        )

        bearer_raw = None
        grype_raw = None

        if bearer_files:
            with open(bearer_files[0]) as f:
                bearer_raw = f.read()
        if grype_files:
            with open(grype_files[0]) as f:
                grype_raw = f.read()

        if bearer_raw is None and grype_raw is None:
            return None

        code_security = []
        if bearer_raw:
            try:
                code_security = _parse_bearer_report(bearer_raw, include_docs=False)
            except Exception:
                pass

        supply_chain = []
        if grype_raw:
            try:
                supply_chain = _parse_grype_report(grype_raw)
            except Exception:
                pass

        return {"supply_chain": supply_chain, "code_security": code_security}

    def _write_json(self, filename: str, data: dict):
        path = os.path.join(WORKSPACE_PATH, filename)
        with open(path, "w") as f:
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

    def _read_cycle_scan_data(self, cycle: int) -> dict:
        cycle_dir = os.path.join(WORKSPACE_PATH, "security", f"cycle{cycle}")
        scan_data: dict = {"supply_chain": [], "code_security": []}

        bearer_path = os.path.join(cycle_dir, "bearer.json")
        if os.path.exists(bearer_path):
            try:
                with open(bearer_path) as f:
                    raw = f.read()
                scan_data["code_security"] = _parse_bearer_report(raw, include_docs=False)
            except Exception as e:
                logger.warning("Failed to parse cycle Bearer report: %s", e)

        grype_path = os.path.join(cycle_dir, "grype.json")
        if os.path.exists(grype_path):
            try:
                with open(grype_path) as f:
                    raw = f.read()
                scan_data["supply_chain"] = _parse_grype_report(raw)
            except Exception as e:
                logger.warning("Failed to parse cycle Grype report: %s", e)

        return scan_data

    def _format_cycle_history(self) -> str:
        parts = []
        for rec in self.cycle_history:
            part = f"### Cycle {rec['cycle']}\n"
            part += f"- **Resolved**: {', '.join(rec['resolved']) or 'None'}\n"
            part += f"- **Remaining**: {', '.join(rec['remaining']) or 'None'}\n"
            part += f"- **New vulnerabilities**: {', '.join(rec['new_vulns']) or 'None'}\n"
            parts.append(part)
        return "\n".join(parts)
