import re
from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

_IDENTIFIER_RE = re.compile(r"[A-Za-z0-9._-]+")


class CustomizeValidationRequest(BaseModel):
    project_id: str
    project_name: str
    project_type: str
    user_id: str
    github_token: Optional[str] = None
    repository_url: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    default_branch: Optional[str] = "main"

    @field_validator("project_id", "user_id")
    @classmethod
    def _safe_identifier(cls, v: str) -> str:
        # project_id and user_id flow into container shell commands and host
        # filesystem paths (e.g. /vol/codebase/<project_id>,
        # <host>/<user_id>/<project_id>), so constrain them to a charset with no
        # shell metacharacters, path separators, or traversal sequences.
        if not v or not _IDENTIFIER_RE.fullmatch(v) or ".." in v:
            raise ValueError(
                "must be a non-empty identifier of [A-Za-z0-9._-] with no '..'"
            )
        return v


class CustomizeValidationResponse(BaseModel):
    success: bool
    message: str


class WebSocketCommand(BaseModel):
    action: Literal["start", "chat", "diff_response"]
    data: Optional[dict] = None


class StreamStatus(str, Enum):
    running = "running"
    preparing = "preparing"
    executing = "executing"
    waiting_diff = "waiting_diff"
    awaiting_decisions = "awaiting_decisions"
    building = "building"
    build_fixing = "build_fixing"
    completed = "completed"
    saving = "saving"
    error = "error"


class CustomizeMessage(BaseModel):
    index: int
    total: int
    type: str
    content: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
