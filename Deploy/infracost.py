#!/usr/bin/env python3

import json
import logging
import os
import subprocess
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ResourceCost:
    name: str
    monthly_cost: float
    components: list[dict]


@dataclass
class CostEstimate:
    total_monthly_cost: float
    total_hourly_cost: float
    resources: list[ResourceCost]
    error: Optional[str] = None

    @staticmethod
    def with_error(error: str) -> 'CostEstimate':
        return CostEstimate(total_monthly_cost=0, total_hourly_cost=0, resources=[], error=error)


def estimate_cost(terraform_dir: str) -> CostEstimate:
    """
    Run infracost breakdown and parse the output.

    Returns:
        CostEstimate with cost data and resources sorted by cost (descending)
    """
    api_key = os.environ.get("INFRACOST_API_KEY")

    if not api_key:
        logger.warning("INFRACOST_API_KEY not set, skipping cost estimation")
        return CostEstimate.with_error("INFRACOST_API_KEY not configured")

    terraform_path = Path(terraform_dir)
    if not terraform_path.exists():
        logger.error(f"Terraform directory not found: {terraform_dir}")
        return CostEstimate.with_error(f"Terraform directory not found: {terraform_dir}")

    output_file = terraform_path / "cost_estimate.json"

    cmd = [
        "infracost", "breakdown",
        "--path", str(terraform_path),
        "--format", "json",
        "--out-file", str(output_file),
        "--no-color"
    ]

    try:
        logger.info(f"Running infracost: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "INFRACOST_API_KEY": api_key}
        )

        if result.returncode != 0:
            error_msg = f"Infracost failed: {result.stderr}"
            logger.error(error_msg)
            return CostEstimate.with_error(error_msg)

        if not output_file.exists():
            logger.error(f"Infracost output file not created: {output_file}")
            return CostEstimate.with_error("Infracost output file not created")

        with open(output_file, 'r') as f:
            data = json.load(f)

        logger.info("Successfully parsed infracost output")
        return _parse_infracost_output(data)

    except subprocess.TimeoutExpired:
        error_msg = "Infracost execution timed out"
        logger.error(error_msg)
        return CostEstimate.with_error(error_msg)
    except FileNotFoundError:
        error_msg = "Infracost CLI not found in PATH"
        logger.error(error_msg)
        return CostEstimate.with_error(error_msg)
    except Exception as e:
        error_msg = f"Unexpected error during cost estimation: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return CostEstimate.with_error(error_msg)


def get_cost_table(terraform_dir: str) -> str:
    """
    Run infracost breakdown with table format for human-readable output.

    Returns:
        Table-formatted cost breakdown string, or error message.
    """
    api_key = os.environ.get("INFRACOST_API_KEY")
    if not api_key:
        return "INFRACOST_API_KEY not configured"

    terraform_path = Path(terraform_dir)
    if not terraform_path.exists():
        return f"Terraform directory not found: {terraform_dir}"

    cmd = [
        "infracost", "breakdown",
        "--path", str(terraform_path),
        "--format", "table",
        "--no-color",
    ]

    try:
        logger.info(f"Running infracost table: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "INFRACOST_API_KEY": api_key},
        )

        if result.returncode != 0:
            return f"Infracost failed: {result.stderr}"

        return result.stdout

    except subprocess.TimeoutExpired:
        return "Infracost execution timed out"
    except FileNotFoundError:
        return "Infracost CLI not found in PATH"
    except Exception as e:
        return f"Unexpected error: {str(e)}"


def _parse_infracost_output(data: dict) -> CostEstimate:
    """Parse infracost JSON output into CostEstimate."""
    try:
        breakdown = data.get("breakdown", {})
        total_monthly_cost = float(breakdown.get("totalMonthlyCost", 0) or 0)
        total_hourly_cost = float(breakdown.get("totalHourlyCost", 0) or 0)

        resources = []

        for resource_data in breakdown.get("resources", []):
            name = resource_data.get("name", "Unknown")
            monthly_cost = float(resource_data.get("monthlyCost", 0) or 0)

            components = []
            for cost_comp in resource_data.get("costComponents", []):
                comp_name = cost_comp.get("name", "Unknown")
                comp_monthly_cost = float(cost_comp.get("monthlyCost", 0) or 0)
                comp_hourly_cost = float(cost_comp.get("hourlyCost", 0) or 0)

                if comp_monthly_cost > 0 or comp_hourly_cost > 0:
                    components.append({
                        "name": comp_name,
                        "monthly_cost": comp_monthly_cost,
                        "hourly_cost": comp_hourly_cost,
                    })

            if monthly_cost > 0 or components:
                resources.append(ResourceCost(
                    name=name,
                    monthly_cost=monthly_cost,
                    components=components
                ))

        resources.sort(key=lambda r: r.monthly_cost, reverse=True)

        logger.info(f"Parsed {len(resources)} resources with total monthly cost: ${total_monthly_cost:.2f}")

        return CostEstimate(
            total_monthly_cost=total_monthly_cost,
            total_hourly_cost=total_hourly_cost,
            resources=resources
        )

    except Exception as e:
        logger.error(f"Error parsing infracost output: {str(e)}", exc_info=True)
        return CostEstimate.with_error(f"Failed to parse cost data: {str(e)}")


def cost_estimate_to_dict(estimate: CostEstimate) -> dict:
    """Convert CostEstimate to JSON-serializable dict."""
    return {
        "total_monthly_cost": estimate.total_monthly_cost,
        "total_hourly_cost": estimate.total_hourly_cost,
        "resources": [
            {
                "name": r.name,
                "monthly_cost": r.monthly_cost,
                "components": r.components
            }
            for r in estimate.resources
        ],
        "error": estimate.error
    }
