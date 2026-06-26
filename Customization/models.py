import re
from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from constants import is_project_stream_branch

_IDENTIFIER_RE = re.compile(r"[A-Za-z0-9._-]+")
# Git refs flow into container shell `git` commands; constrain to safe ref chars.
_REF_RE = re.compile(r"[A-Za-z0-9._/-]+")


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
    # Branch-aware selection (set by the validate route for popup-driven sessions;
    # absent → legacy single-stream behavior).
    base_branch: Optional[str] = None
    customize_branch: Optional[str] = None
    is_new_branch: bool = False

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

    @field_validator("base_branch", "customize_branch")
    @classmethod
    def _safe_ref(cls, v: Optional[str]) -> Optional[str]:
        # base_branch and customize_branch are interpolated into container shell
        # `git` commands (checkout / fetch / push), so reject anything outside a
        # safe git-ref charset or containing a traversal sequence.
        if v is None:
            return v
        # Reject leading '-' too: git itself forbids it in ref names, and without
        # this guard a value like "-f" / "--orphan" would be parsed as an option by
        # `git checkout {base_branch}` rather than as a branch (argument injection).
        if not v or not _REF_RE.fullmatch(v) or ".." in v or v.startswith("-"):
            raise ValueError(
                "must be a safe git ref of [A-Za-z0-9._/-], not starting with '-', with no '..'"
            )
        return v

    @model_validator(mode="after")
    def _customize_branch_in_namespace(self) -> "CustomizeValidationRequest":
        # Defense-in-depth mirroring the validate-route guard: a customize_branch,
        # when present, must live in this project's deplai/customize- namespace so
        # the publish step can never be coaxed into force-pushing an arbitrary branch.
        if self.customize_branch is not None and not is_project_stream_branch(
            self.customize_branch, self.project_id
        ):
            raise ValueError(
                "customize_branch must be within the project's deplai/customize- namespace"
            )
        return self


class CustomizeValidationResponse(BaseModel):
    success: bool
    message: str


class PreviewValidationRequest(BaseModel):
    project_id: str
    project_name: str
    project_type: str
    user_id: str
    github_token: Optional[str] = None
    repository_url: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    # The single branch to clone into the LivePreview volume (github only). The
    # Connector resolves this read-only: a customization PR's head branch (to
    # preview the customized result) or any plain branch (to preview as-is).
    branch: Optional[str] = None

    @field_validator("project_id", "user_id")
    @classmethod
    def _safe_identifier(cls, v: str) -> str:
        # Same constraint as CustomizeValidationRequest: these flow into
        # container shell commands and host filesystem paths.
        if not v or not _IDENTIFIER_RE.fullmatch(v) or ".." in v:
            raise ValueError(
                "must be a non-empty identifier of [A-Za-z0-9._-] with no '..'"
            )
        return v

    @field_validator("branch")
    @classmethod
    def _safe_branch(cls, v: Optional[str]) -> Optional[str]:
        # branch is interpolated into a container `git checkout`, so reject
        # anything outside a safe git-ref charset, a traversal, or a leading '-'
        # (which git would parse as an option).
        if v is None:
            return v
        if not v or not _REF_RE.fullmatch(v) or ".." in v or v.startswith("-"):
            raise ValueError(
                "must be a safe git ref of [A-Za-z0-9._/-], not starting with '-', with no '..'"
            )
        return v


class WebSocketCommand(BaseModel):
    action: Literal["start", "chat", "diff_response", "grant_all"]
    data: Optional[dict] = None


class PreviewWebSocketCommand(BaseModel):
    # Teardown is handled exclusively by POST /api/preview/stop (the single
    # authoritative cleanup path); the socket only starts a preview.
    action: Literal["start"]
    data: Optional[dict] = None


class StreamStatus(str, Enum):
    running = "running"
    preparing = "preparing"
    executing = "executing"
    building = "building"
    build_fixing = "build_fixing"
    completed = "completed"
    saving = "saving"
    error = "error"


class PreviewStatus(str, Enum):
    preparing = "preparing"
    installing = "installing"
    starting = "starting"
    ready = "ready"
    error = "error"


class CustomizeMessage(BaseModel):
    index: int
    total: int
    type: str
    content: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
