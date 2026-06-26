import io
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import markdown as md
from jinja2 import Environment, FileSystemLoader, select_autoescape

from utils import read_artifact_file, find_latest_cycle

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"
_VALID_SEVERITIES = {"critical", "high", "medium", "low"}


def _sev_class(severity) -> str:
    s = (severity or "").strip().lower()
    return s if s in _VALID_SEVERITIES else "low"


def _sev_label(severity) -> str:
    s = (severity or "").strip()
    return s.title() if s else "Unknown"


def _build_context(scan_data: dict, report_md: str, project_name: str) -> dict:
    supply_chain = [
        {
            "name": v.get("name", ""),
            "cve_id": v.get("cve_id", ""),
            "severity": _sev_label(v.get("severity")),
            "sev_class": _sev_class(v.get("severity")),
        }
        for v in scan_data.get("supply_chain", [])
        if v.get("cve_id")
    ]
    code_security = [
        {
            "title": g.get("title", ""),
            "cwe_id": g.get("cwe_id", ""),
            "count": g.get("count") if g.get("count") is not None else len(g.get("occurrences") or []),
            "severity": _sev_label(g.get("severity")),
            "sev_class": _sev_class(g.get("severity")),
        }
        for g in scan_data.get("code_security", [])
        if g.get("cwe_id")
    ]

    buckets = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for item in supply_chain + code_security:
        buckets[item["sev_class"]] += 1

    summary = {"total_open": len(supply_chain) + len(code_security), **buckets}

    if report_md and report_md.strip():
        reasons_html = md.markdown(report_md)
    else:
        reasons_html = "<p class='muted'>No remediation notes were generated.</p>"

    return {
        "project_name": project_name or "—",
        "generated_on": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "summary": summary,
        "supply_chain": supply_chain,
        "code_security": code_security,
        "reasons_html": reasons_html,
    }


def _render_html(context: dict) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    return env.get_template("vulnerability_report.html").render(**context)


def _safe_url_fetcher(url: str):
    # The report template is fully self-contained (inline styles, no external
    # assets), so the only resource URLs that can appear come from the untrusted
    # remediation markdown. Allow only data: URIs; block file:// (local file
    # disclosure) and http(s):// (SSRF).
    if url.startswith("data:"):
        from weasyprint.urls import default_url_fetcher
        return default_url_fetcher(url)
    raise ValueError(f"Blocked disallowed resource URL in report: {url[:60]}")


def _render_pdf(html_str: str) -> bytes:
    from weasyprint import HTML

    buf = io.BytesIO()
    HTML(string=html_str, url_fetcher=_safe_url_fetcher).write_pdf(target=buf)
    return buf.getvalue()


def render_vulnerability_report_pdf(project_id: str, project_name: str = "") -> bytes | None:
    cycle = find_latest_cycle()
    if cycle is None:
        logger.warning("Report requested but no cycle directories found")
        return None

    raw = read_artifact_file(f"security/cycle{cycle}/scan_data.json")
    if not raw:
        logger.warning("Report requested but cycle%s/scan_data.json missing", cycle)
        return None
    try:
        scan_data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("scan_data.json unparseable: %s", e)
        return None

    report_md = read_artifact_file(f"security/cycle{cycle}/Report.md") or ""
    context = _build_context(scan_data, report_md, project_name)
    return _render_pdf(_render_html(context))
