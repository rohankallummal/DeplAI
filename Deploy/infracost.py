#!/usr/bin/env python3

import json
import logging
import os
from dataclasses import dataclass
from typing import Optional

import docker

from utils import get_docker_client, read_volume_file, decode_output, DEPLOY_VOLUME

logger = logging.getLogger(__name__)

INFRACOST_IMAGE = "infracost/infracost:ci-latest"


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
    summary: dict | None = None
    error: Optional[str] = None

    @staticmethod
    def with_error(error: str) -> 'CostEstimate':
        return CostEstimate(total_monthly_cost=0, total_hourly_cost=0, resources=[], error=error)


def _ensure_image(client: docker.DockerClient):
    """Pull the infracost Docker image if not already present."""
    try:
        client.images.get(INFRACOST_IMAGE)
    except docker.errors.ImageNotFound:
        logger.info(f"Pulling {INFRACOST_IMAGE}...")
        client.images.pull("infracost/infracost", tag="ci-latest")


def _run_infracost(command: list[str]) -> bytes:
    """Run infracost via Docker with the Deploy volume mounted. Returns stdout."""
    api_key = os.environ.get("INFRACOST_API_KEY")
    if not api_key:
        raise ValueError("INFRACOST_API_KEY not configured")

    client = get_docker_client()
    _ensure_image(client)

    return client.containers.run(
        INFRACOST_IMAGE,
        command=command,
        environment={"INFRACOST_API_KEY": api_key},
        volumes={DEPLOY_VOLUME: {"bind": "/code", "mode": "rw"}},
        remove=True,
    )


def estimate_cost() -> CostEstimate:
    """Run infracost breakdown via Docker and return parsed cost data."""
    try:
        logger.info("Running infracost breakdown via Docker (%s)", INFRACOST_IMAGE)
        _run_infracost([
            "breakdown",
            "--path", "/code/terraform/code",
            "--format", "json",
            "--out-file", "/code/terraform/cost/cost_estimate.json",
        ])

        raw_json = read_volume_file("terraform/cost/cost_estimate.json")
        if not raw_json:
            return CostEstimate.with_error("Infracost output file not found in volume")

        return _parse_infracost_output(json.loads(raw_json))

    except ValueError as e:
        logger.warning(str(e))
        return CostEstimate.with_error(str(e))
    except docker.errors.ContainerError as e:
        error_msg = f"Infracost container exited with error: {e.stderr.decode(errors='replace') if e.stderr else str(e)}"
        logger.error(error_msg)
        return CostEstimate.with_error(error_msg)
    except Exception as e:
        error_msg = f"Infracost Docker execution failed: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return CostEstimate.with_error(error_msg)


def get_cost_table() -> str:
    """Run infracost breakdown with table format via Docker."""
    try:
        logger.info("Running infracost table via Docker")
        output = _run_infracost([
            "breakdown",
            "--path", "/code/terraform/code",
            "--format", "table",
        ])
        return decode_output(output)

    except ValueError as e:
        return str(e)
    except docker.errors.ContainerError as e:
        return f"Infracost failed: {e.stderr.decode(errors='replace') if e.stderr else str(e)}"
    except Exception as e:
        return f"Infracost Docker execution failed: {str(e)}"


def _collect_components(resource_data: dict) -> list[dict]:
    """Recursively collect cost components from a resource and its subresources."""
    components = []

    for cost_comp in resource_data.get("costComponents", []):
        comp_monthly = float(cost_comp.get("monthlyCost", 0) or 0)
        comp_hourly = float(cost_comp.get("hourlyCost", 0) or 0)

        if comp_monthly > 0 or comp_hourly > 0:
            components.append({
                "name": cost_comp.get("name", "Unknown"),
                "monthly_cost": comp_monthly,
                "hourly_cost": comp_hourly,
            })

    for sub in resource_data.get("subresources", []):
        components.extend(_collect_components(sub))

    return components


def _parse_infracost_output(data: dict) -> CostEstimate:
    """Parse infracost JSON v0.2 output into CostEstimate."""
    try:
        total_monthly_cost = float(data.get("totalMonthlyCost", 0) or 0)
        total_hourly_cost = float(data.get("totalHourlyCost", 0) or 0)

        resources = []
        for project in data.get("projects", []):
            breakdown = project.get("breakdown", {})
            for resource_data in breakdown.get("resources", []):
                name = resource_data.get("name", "Unknown")
                monthly_cost = float(resource_data.get("monthlyCost", 0) or 0)
                components = _collect_components(resource_data)

                if monthly_cost > 0 or components:
                    resources.append(ResourceCost(
                        name=name,
                        monthly_cost=monthly_cost,
                        components=components,
                    ))

        resources.sort(key=lambda r: r.monthly_cost, reverse=True)

        summary = None
        raw_summary = data.get("summary")
        if raw_summary:
            summary = {
                "total_resources": raw_summary.get("totalDetectedResources", 0),
                "estimated_resources": raw_summary.get("totalSupportedResources", 0),
                "free_resources": raw_summary.get("totalNoPriceResources", 0),
                "unsupported_resources": raw_summary.get("totalUnsupportedResources", 0),
            }

        logger.info(
            "Parsed %d resources with total monthly cost: $%.2f",
            len(resources), total_monthly_cost,
        )

        return CostEstimate(
            total_monthly_cost=total_monthly_cost,
            total_hourly_cost=total_hourly_cost,
            resources=resources,
            summary=summary,
        )

    except Exception as e:
        logger.error("Error parsing infracost output: %s", e, exc_info=True)
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
                "components": r.components,
            }
            for r in estimate.resources
        ],
        "summary": estimate.summary,
        "error": estimate.error,
    }
