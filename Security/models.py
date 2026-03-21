from enum import Enum
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Literal, Optional


class ScanValidationRequest(BaseModel):
    project_id: str
    project_name: str
    project_type: str
    user_id: str
    github_token: Optional[str] = None
    repository_url: Optional[str] = None


class ScanValidationResponse(BaseModel):
    success: bool
    message: str
    data: ScanValidationRequest


class WebSocketCommand(BaseModel):
    action: Literal["start"]


class StreamStatus(str, Enum):
    running = "running"
    completed = "completed"
    error = "error"


ScanContext = ScanValidationRequest


class ScanMessage(BaseModel):
    index: int
    total: int
    type: str
    content: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class RemediationValidationRequest(BaseModel):
    project_id: str


class RemediationValidationResponse(BaseModel):
    success: bool
    message: str


class StoreTokenRequest(BaseModel):
    user_id: str
    token: str
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None


class CreateRepoRequest(BaseModel):
    project_id: str
    project_name: str
    user_id: str
    owner: str


class CreatePRRequest(BaseModel):
    project_id: str
    user_id: str
    owner: str
    repo: str
    default_branch: str = "main"


class PublishResponse(BaseModel):
    success: bool
    message: str
    url: Optional[str] = None
