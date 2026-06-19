"""Single source of truth for DeplAI customization branch naming.

Mirror: Connector/src/lib/customize-branches.ts — keep both in sync.
"""

DEPLAI_BRANCH_PREFIX = "deplai/customize-"


def legacy_stream_branch(project_id: str) -> str:
    """The legacy / first-stream branch for a project."""
    return f"{DEPLAI_BRANCH_PREFIX}{project_id}"


def is_deplai_branch(ref: str) -> bool:
    """Any DeplAI automation branch (regardless of project)."""
    return ref.startswith(DEPLAI_BRANCH_PREFIX)


def is_project_stream_branch(ref: str, project_id: str) -> bool:
    """A DeplAI stream branch belonging to this specific project: the exact legacy
    branch or a `-{shortid}` stream of it."""
    return ref == legacy_stream_branch(project_id) or ref.startswith(
        f"{DEPLAI_BRANCH_PREFIX}{project_id}-"
    )
