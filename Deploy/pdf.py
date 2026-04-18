import io
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from utils import read_volume_file

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _fmt_money(value, fraction_digits: int = 2) -> str:
    try:
        return f"{float(value):,.{fraction_digits}f}"
    except (TypeError, ValueError):
        return "0.00"


def _fmt_qty(value) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return "—"
    if f == 0:
        return "0"
    abs_f = abs(f)
    if abs_f >= 1:
        return f"{f:,.2f}"
    if abs_f >= 0.01:
        return f"{f:.4f}"
    return f"{f:.6f}"


def _fmt_unit_price(value) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return "—"
    if f == 0:
        return "0"
    if abs(f) >= 1:
        return f"{f:,.4f}"
    return f"{f:.6f}"


def _build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    env.filters["fmt_money"] = _fmt_money
    env.filters["fmt_qty"] = _fmt_qty
    env.filters["fmt_unit_price"] = _fmt_unit_price
    env.globals["max"] = max
    return env


def _parse_components(raw_components: list) -> list[dict]:
    parsed = []
    for c in raw_components or []:
        parsed.append({
            "name": c.get("name", "Unknown"),
            "unit": c.get("unit") or "",
            "monthly_quantity": c.get("monthlyQuantity"),
            "hourly_quantity": c.get("hourlyQuantity"),
            "price": c.get("price"),
            "monthly_cost": float(c.get("monthlyCost") or 0),
            "hourly_cost": float(c.get("hourlyCost") or 0),
            "price_not_applicable": bool(c.get("priceNotApplicable")),
        })
    return parsed


def _parse_resource(raw: dict) -> dict:
    return {
        "name": raw.get("name", "Unknown"),
        "resource_type": raw.get("resourceType") or "",
        "tags": raw.get("tags") or {},
        "monthly_cost": float(raw.get("monthlyCost") or 0),
        "hourly_cost": float(raw.get("hourlyCost") or 0),
        "components": _parse_components(raw.get("costComponents", [])),
        "subresources": [_parse_resource(s) for s in raw.get("subresources", []) or []],
    }


def _flatten_type_counts(raw: dict | list | None) -> list[dict]:
    if not raw:
        return []
    if isinstance(raw, dict):
        items = [{"type": k, "count": int(v or 0)} for k, v in raw.items()]
    else:
        items = []
        for entry in raw:
            if isinstance(entry, dict):
                t = entry.get("resourceType") or entry.get("type") or "Unknown"
                items.append({"type": t, "count": int(entry.get("count") or 0)})
    items.sort(key=lambda x: (-x["count"], x["type"]))
    return items


def _build_full_context(raw_data: dict, project_name: str) -> dict:
    total_monthly = float(raw_data.get("totalMonthlyCost") or 0)
    total_hourly = float(raw_data.get("totalHourlyCost") or 0)
    daily = total_monthly / 30 if total_monthly else 0
    yearly = total_hourly * 24 * 365 if total_hourly else 0

    projects = []
    for p in raw_data.get("projects", []) or []:
        breakdown = p.get("breakdown") or {}
        resources = [_parse_resource(r) for r in breakdown.get("resources", []) or []]
        resources.sort(key=lambda r: r["monthly_cost"], reverse=True)
        projects.append({
            "name": p.get("name") or "",
            "path": (p.get("metadata") or {}).get("path") or "",
            "monthly_cost": float(breakdown.get("totalMonthlyCost") or 0),
            "hourly_cost": float(breakdown.get("totalHourlyCost") or 0),
            "resources": resources,
        })

    max_cost = 0.0
    for p in projects:
        for r in p["resources"]:
            if r["monthly_cost"] > max_cost:
                max_cost = r["monthly_cost"]
    if max_cost == 0:
        max_cost = 1

    raw_summary = raw_data.get("summary") or {}
    summary = {
        "total_resources": int(raw_summary.get("totalDetectedResources") or 0),
        "estimated_resources": int(raw_summary.get("totalSupportedResources") or 0),
        "free_resources": int(raw_summary.get("totalNoPriceResources") or 0),
        "unsupported_resources": int(raw_summary.get("totalUnsupportedResources") or 0),
        "usage_based_resources": int(raw_summary.get("totalUsageBasedResources") or 0),
    }

    unsupported = _flatten_type_counts(raw_summary.get("unsupportedResourceCounts"))
    no_price = _flatten_type_counts(raw_summary.get("noPriceResourceCounts"))

    time_generated = raw_data.get("timeGenerated")
    if time_generated:
        try:
            ts = datetime.fromisoformat(time_generated.replace("Z", "+00:00"))
            generated_on = ts.strftime("%Y-%m-%d %H:%M UTC")
        except ValueError:
            generated_on = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    else:
        generated_on = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return {
        "project_name": project_name or "—",
        "generated_on": generated_on,
        "currency": raw_data.get("currency") or "USD",
        "infracost_version": raw_data.get("version") or "",
        "total_monthly": total_monthly,
        "total_hourly": total_hourly,
        "daily_cost": daily,
        "yearly_cost": yearly,
        "max_resource_cost": max_cost,
        "projects": projects,
        "summary": summary,
        "unsupported": unsupported,
        "no_price": no_price,
    }


def render_cost_pdf(project_name: str = "") -> Optional[bytes]:
    raw_json = read_volume_file("terraform/cost/cost_estimate.json")
    if not raw_json:
        logger.warning("Cost PDF requested but cost_estimate.json not found in volume")
        return None

    try:
        raw_data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        logger.error("Cost JSON unparseable: %s", e)
        return None

    context = _build_full_context(raw_data, project_name)

    env = _build_env()
    template = env.get_template("cost_breakdown.html")
    html_str = template.render(**context)

    buf = io.BytesIO()
    HTML(string=html_str).write_pdf(target=buf)
    return buf.getvalue()
