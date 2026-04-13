from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class CustomizeValidationResponse(BaseModel):
    success: bool
    message: str


class WebSocketCommand(BaseModel):
    action: Literal["start", "chat", "diff_response", "save", "discard"]
    data: Optional[dict] = None


class StreamStatus(str, Enum):
    running = "running"
    preparing = "preparing"
    executing = "executing"
    waiting_diff = "waiting_diff"
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
