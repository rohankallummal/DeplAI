from enum import Enum
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Literal, Optional


class DeployValidationRequest(BaseModel):
    project_id: str
    project_name: str
    project_type: str
    user_id: str
    github_token: Optional[str] = None
    repository_url: Optional[str] = None


class DeployValidationResponse(BaseModel):
    success: bool
    message: str


class WebSocketCommand(BaseModel):
    action: Literal["start", "answer", "deploy_confirmation"]
    data: Optional[dict] = None


class StreamStatus(str, Enum):
    running = "running"
    analyzing = "analyzing"
    clarifying = "clarifying"
    architecting = "architecting"
    terraforming = "terraforming"
    costing = "costing"
    completed = "completed"
    error = "error"


class DeployMessage(BaseModel):
    index: int
    total: int
    type: str
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DestroyRequest(BaseModel):
    project_id: str
