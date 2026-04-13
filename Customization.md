# Customization System Report

## Overview

The Customization system is an agentic platform that allows users to request UI/UX changes to their codebases through natural language. A Claude-powered agent analyzes the project, implements the requested changes, and presents file-level diffs for user approval before applying them. Changes can be saved locally or published as a GitHub pull request.

**Tech stack:** FastAPI (Python 3.12), Anthropic `claude-agent-sdk`, Docker, WebSocket.

---

## Architecture

```
Frontend (WebSocket client)
    |
    v
main.py ── FastAPI server (port 8002)
    |
    v
runner.py ── CustomizationRunner (orchestration)
    |                 |
    |                 |── runner_base.py (WebSocket messaging, state)
    |                 |── publish.py (save local / create GitHub PR)
    |                 |── utils.py (Docker container & volume management)
    |                 |
    |                 v
    |        Docker container ("customize-agent")
    |            |
    |            |── pipeline.py (CLI entry point inside container)
    |            |       |
    |            |       v
    |            |   agent/styler.py (Claude agent via claude-agent-sdk)
    |            |       |
    |            |       v
    |            |   Claude Code CLI tools (Read, Glob, Grep, Edit, Bash)
    |            |       |
    |            |       v
    |            |   hooks/diff_hook.sh (PreToolUse hook intercepting Edit)
    |            |
    |            |── /workspace/codebase   [customizeCode volume]
    |            |── /workspace/customize  [CustomizeWork volume - IPC files]
    |
    v
File-based IPC (pending_diff.json, diff_response.json, etc.)
```

### Container topology

The FastAPI server runs in one Docker container (`customize` service). It creates a second long-lived Docker container (`customize-agent`) where the Claude agent actually executes. The two communicate via shared Docker volumes and `docker exec` calls from the server into the agent container.

---

## File inventory

| File | Purpose |
|---|---|
| `main.py` | FastAPI application, HTTP + WebSocket endpoints, lifecycle management |
| `models.py` | Pydantic models and enums for requests, commands, messages, status |
| `runner.py` | `CustomizationRunner` - main workflow orchestrator |
| `runner_base.py` | `RunnerBase` - abstract base with WebSocket messaging, cancellation, reattachment |
| `pipeline.py` | CLI entry point that runs inside the Docker container; dispatches agent phases |
| `agent/styler.py` | The Claude agent: configures and runs `claude-agent-sdk` with the styler prompt |
| `prompt/styler.md` | System prompt instructing the agent how to analyze and modify code |
| `hooks/diff_hook.sh` | PreToolUse hook that intercepts every `Edit` call for file-level approval |
| `publish.py` | Save logic: copy files back to host (local) or create a GitHub PR |
| `utils.py` | Docker client singleton, container/volume CRUD, helper functions |
| `Dockerfile` | Builds the `deplai-customize` image (Python 3.12, Node.js 20, Claude Code CLI) |
| `docker-compose.yml` | Defines the `customize` service, networking, and volume mounts |
| `.env` | Environment variables: service key, host projects path, Anthropic API key |
| `requirements.txt` | Python dependencies |

---

## Data models (`models.py`)

### CustomizeValidationRequest

Sent by the frontend before establishing the WebSocket connection. Stores all project metadata the system needs.

```
project_id, project_name, project_type, user_id
github_token?, repository_url?, owner?, repo?, default_branch? (default: "main")
```

### WebSocketCommand

Every WebSocket message from the frontend is parsed into this model.

```
action: "start" | "chat" | "diff_response" | "save" | "discard"
data: optional dict (contents depend on action)
```

### StreamStatus (enum)

Tracks the runner's lifecycle phase:

```
running -> preparing -> executing -> waiting_diff -> completed
                                                  -> saving
                                                  -> error
```

### CustomizeMessage

Indexed message model sent to the frontend with `type`, `content`, `timestamp`, `index`, and `total` (step count).

---

## Server (`main.py`)

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/customize/validate` | Stores project context; must be called before WebSocket |
| `WS` | `/ws/customize/{project_id}` | Bidirectional communication channel for the entire workflow |
| `GET` | `/api/customize/status/{project_id}` | Polls whether a customization is active, its phase, and if changes were made |
| `POST` | `/api/cleanup` | Cancels all runners, removes containers and volumes |
| `GET` | `/health` | Health check |

### Authentication

All HTTP endpoints require an `X-API-Key` header matching `DEPLAI_SERVICE_KEY`. The WebSocket authenticates via a `token` query parameter.

### In-memory state

```python
customize_contexts: dict[str, CustomizeValidationRequest]  # stored project contexts
active_customizations: dict[str, CustomizationRunner]       # live runner instances
_last_project_id: str | None                                # for artifact cleanup between runs
```

### WebSocket action handling

| Action | Behavior |
|---|---|
| `start` | Creates a new `CustomizationRunner` (or reattaches to an existing one) and kicks off the pipeline as an async task |
| `chat` | Delivers the user's customization request text to the runner |
| `diff_response` | Delivers the user's approve/reject decision for a file diff |
| `save` | Triggers saving changes (local copy or GitHub PR) |
| `discard` | Clears volumes, discarding all modifications |

On WebSocket disconnect, the runner is detached (not cancelled), allowing reconnection and message replay.

### Artifact cleanup

When a new project starts and a previous project existed, `clear_customize_artifacts()` runs to clean stale IPC files from the work volume before the new session begins.

---

## Runner base (`runner_base.py`)

Abstract base class providing:

- **WebSocket lifecycle**: `attach()` replays up to 50 recent messages for reconnecting clients. `detach()` nulls the socket without cancelling. `_try_send()` silently handles send failures.
- **Cancellation**: `cancel()` sets a flag; `_check_cancelled()` raises `CancelledError` at safe checkpoints.
- **Messaging helpers**: `_send_message()` (indexed progress messages), `_send_status()` (phase transitions), `_send_result()` (final outcome), `_terminate()` (error + status).
- **Entry point**: `run()` calls the abstract `_run_pipeline()`, sets final status to `completed` or `error`.

---

## Customization runner (`runner.py`)

`CustomizationRunner` extends `RunnerBase` and orchestrates the entire workflow.

### Event coordination

Three `asyncio.Event` objects synchronize the server, the WebSocket client, and the Docker-resident agent:

| Event | Set by | Waited by | Purpose |
|---|---|---|---|
| `_chat_event` | `receive_chat_message()` | `_run_pipeline()` | Blocks until the user submits their customization request |
| `_diff_response_event` | `receive_diff_response()` | `_handle_diff_approval()` | Blocks until the user approves or rejects a file diff |
| `_agent_done` | `_run_pipeline()` | `_monitor_diffs()` | Signals that the agent subprocess has finished |

### Pipeline flow (`_run_pipeline`)

```
1. Create / get the customize-agent container
2. Copy codebase into Docker volume
   - Local projects: Alpine container copies from host mount
   - GitHub projects: alpine/git container clones the repo
3. Set file permissions (chmod/chown as root)
4. Verify Claude Code CLI is installed ("claude --version")
5. Send status=running, wait for user's chat message (_chat_event)
6. Send status=executing
7. Launch two concurrent tasks:
   a. _run_agent_phase_async("execute") — runs the styler agent
   b. _monitor_diffs() — polls for pending diffs
8. When agent finishes, set _agent_done, await monitor task
9. Flush any remaining unapproved edits for the last file
10. Send result (success, changes_made)
```

### Agent execution (`_run_agent_phase`)

Runs `python -m pipeline --phase execute --user-request "..."` inside the agent container via `docker exec`, streams stdout line-by-line, parses JSON messages from the subprocess, and relays errors to the log. Returns the parsed `result` message when the process ends.

### Diff monitoring (`_monitor_diffs`)

Polls `/workspace/customize/pending_diff.json` every 500ms. When found:

1. Parses the diff data (file_path, diff_id, hunks)
2. Sends a `diff_preview` WebSocket message to the frontend
3. Sets status to `waiting_diff`
4. Waits for `_diff_response_event`
5. Writes the response to `diff_response.json` so the hook can unblock
6. If approved, sets `_changes_made = True`
7. If rejected (during flush), restores the file from backup
8. Returns status to `executing`

### Remaining-edit flush (`_flush_remaining_edits`)

The diff hook only sends hunks to the runner on file transitions (when the agent starts editing a different file). The last file edited has no transition to trigger sending. After the agent finishes, this method reads any accumulated hunks from `edit_accumulator.json`, merges overlapping context, and sends a final diff for approval. If rejected, it reverts the file from backup.

### Hunk merging

Both the hook and the runner implement the same hunk-merge algorithm: hunks are sorted by first line number, then adjacent hunks with overlapping line ranges have their context lines deduplicated and are combined into a single hunk.

### Save and discard

- **`save_changes()`**: For local projects, calls `save_local_changes()` (copies volume back to host). For GitHub projects, calls `create_customize_pr()` (pushes branch, opens PR). Sends `save_result` to frontend.
- **`discard_changes()`**: Clears both volumes.
- **`cancel()`**: Sets cancellation flag and kills the `pipeline.py` process inside the container via `pkill`.

---

## Pipeline (`pipeline.py`)

CLI entry point executed inside the Docker container. Accepts `--phase`, `--project-name`, `--project-id`, and `--user-request` arguments.

Currently supports one phase:

- **`execute`**: Imports `agent.styler.run()`, passes the codebase path (`/workspace/codebase`) and user request, emits JSON-line messages to stdout (`{"type": "phase|success|error", "content": "..."}`) and a final `{"type": "result", "data": {...}}`.

The `PHASE_RUNNERS` dict maps phase names to async handler functions, making it extensible for future phases.

---

## Styler agent (`agent/styler.py`)

The core AI component. Uses Anthropic's `claude-agent-sdk` to run a Claude Sonnet agent with tool access.

### Configuration

```python
ClaudeAgentOptions(
    model="sonnet",
    allowed_tools=["Read", "Glob", "Grep", "Edit", "Bash"],
    permission_mode="acceptEdits",
    cwd="/workspace/codebase",
    max_turns=80,
    system_prompt=SYSTEM_PROMPT,  # loaded from prompt/styler.md
)
```

### Agent prompt

The user prompt sent to the agent:

```
The user wants the following changes to their frontend project:
"<user_request>"

Analyze the codebase at /workspace/codebase, figure out which files need to change,
and execute the changes.
Use the Edit tool to make each change. Each edit will be reviewed before being applied.
If an edit is rejected, note it and continue with the remaining changes.
```

### System prompt (`prompt/styler.md`)

Instructs the agent to:
1. Understand the user's customization request
2. Explore the project structure, tech stack, and patterns before editing
3. Make one edit at a time via the `Edit` tool
4. Accept rejections gracefully and move on
5. Read files before modifying them
6. Preserve existing code style and patterns
7. Only make changes relevant to the request
8. Consider side effects (e.g., updating imports when renaming)
9. Skip files that don't exist rather than guessing

### Execution loop

The agent runs as an async generator (`async for event in query(...)`). Each iteration is one agent turn. The loop counts turns and logs progress. On success, returns `StylerResult(success=True)`. On exception, returns `StylerResult(success=False, error=...)`.

---

## Diff hook (`hooks/diff_hook.sh`)

A bash script wrapping an inline Python program. Registered as a Claude Code `PreToolUse` hook for the `Edit` tool in `/home/agent/.claude/settings.json` during Docker image build.

### How it works

Every time the Claude agent calls the `Edit` tool, this hook runs before the edit is applied. It receives the tool input (file_path, old_string, new_string) via stdin as JSON.

### Per-edit behavior

1. **Read current state**: checks `current_edit_file.txt` to see which file was previously being edited
2. **File transition detection**: if the file being edited is different from the previous one:
   - Reads accumulated hunks from `edit_accumulator.json`
   - Sends them via `pending_diff.json` for user approval
   - Polls `diff_response.json` for up to 300 seconds (5 minutes)
   - If rejected: reverts the previous file from `file_backup`
   - Clears the accumulator for the new file
3. **New file setup**: if this is the first edit to a file, backs up the original file to `file_backup`
4. **Hunk accumulation**: builds a hunk (changed lines with 3 lines of context) and appends to `edit_accumulator.json`
5. **Always exits 0**: the edit is allowed to proceed. Approval/rejection happens at file boundaries, not per-edit. If a file is rejected, it gets reverted from backup.

### IPC files (in `/workspace/customize/`)

| File | Written by | Read by | Purpose |
|---|---|---|---|
| `edit_accumulator.json` | Hook | Hook, Runner (flush) | Array of hunks for the current file |
| `current_edit_file.txt` | Hook | Hook, Runner (flush) | Path of the file currently being edited |
| `file_backup` | Hook | Hook, Runner (flush) | Copy of the file before any edits began |
| `pending_diff.json` | Hook | Runner (poll) | Diff payload awaiting user approval |
| `diff_response.json` | Runner | Hook (poll) | User's approval/rejection response |

### Hunk format

```json
{
  "lines": [
    {"type": "ctx", "num": 10, "text": "  unchanged line"},
    {"type": "del", "num": 11, "text": "  old line"},
    {"type": "add", "num": 11, "text": "  new line"},
    {"type": "ctx", "num": 12, "text": "  unchanged line"}
  ]
}
```

---

## Publishing (`publish.py`)

### Local save (`save_local_changes`)

Runs an Alpine container that copies the modified codebase from the `customizeCode` Docker volume back to the host filesystem (resolved via `HOST_PROJECTS_DIR` or a fallback path under `Connector/tmp`).

### GitHub PR (`create_customize_pr`)

1. Resolves the GitHub user's name and email via the GitHub API
2. Runs an `alpine/git` container that:
   - Creates a branch named `deplai/customize-{project_id}`
   - Stages and commits all changes with message `"feat: UI customization applied by DeplAI"`
   - Force-pushes to origin
3. Creates a pull request via `POST /repos/{owner}/{repo}/pulls`
4. Handles the 422 "PR already exists" case by fetching and returning the existing PR URL
5. Falls back to returning the repo URL if the PR API fails but the branch was pushed

---

## Docker infrastructure

### Image build (`Dockerfile`)

```
Base: python:3.12-slim
  + gcc, git, curl
  + Node.js 20.x
  + Claude Code CLI (npm: @anthropic-ai/claude-code)
  + Python dependencies (requirements.txt)
  + Non-root "agent" user
  + Claude settings.json with PreToolUse hook for Edit interception
  + Application code
Port: 8002
CMD: uvicorn main:app --host 0.0.0.0 --port 8002
```

The Claude Code settings written during build:
```json
{
  "ackTos": true,
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit",
      "hooks": [{"type": "command", "command": "/app/hooks/diff_hook.sh"}]
    }]
  }
}
```

### Service composition (`docker-compose.yml`)

Single service `customize` with:
- Docker socket bind mount (for creating the agent container)
- Host projects directory bind mount (read-only, for copying local codebases)
- Bridge network `deplai`

### Runtime container (`customize-agent`)

Created dynamically by `get_or_create_customize_container()`:
- Image: `deplai-customize`
- Command: `sleep infinity` (long-lived)
- Runs as user `agent`
- Mounts: Docker socket, `customizeCode` volume at `/workspace/codebase`, `CustomizeWork` volume at `/workspace/customize`
- Network: `customization_deplai`
- Environment: `HOME=/home/agent`, `ANTHROPIC_API_KEY`

### Volume layout

| Volume | Mount point | Purpose |
|---|---|---|
| `customizeCode` | `/workspace/codebase` | The project's source code (copied in or cloned) |
| `CustomizeWork` | `/workspace/customize` | IPC files for diff hook communication |

---

## Complete workflow sequence

```
1. Frontend: POST /api/customize/validate  (stores project context)
2. Frontend: WS  /ws/customize/{project_id}
3. Frontend: send {"action": "start"}
      -> Server creates CustomizationRunner, starts pipeline task
      -> Pipeline copies codebase into Docker volume
      -> Pipeline verifies Claude CLI
      -> Server sends status: "running"

4. Frontend: send {"action": "chat", "data": {"message": "Make the navbar blue"}}
      -> Runner unblocks, sends status: "executing"
      -> Runs pipeline.py inside Docker container
      -> pipeline.py calls agent/styler.py
      -> Claude agent reads codebase, starts making Edit calls

5. For each Edit call inside the container:
      -> diff_hook.sh intercepts, builds hunk, accumulates
      -> On file transition: writes pending_diff.json
      -> Runner polls, finds pending_diff.json
      -> Runner sends diff_preview to frontend via WebSocket
      -> Runner sends status: "waiting_diff"

6. Frontend: send {"action": "diff_response", "data": {"diff_id": "...", "approved": true}}
      -> Runner writes diff_response.json
      -> Hook reads response, proceeds
      -> If rejected: hook reverts file from backup
      -> Runner sends status: "executing"
      -> Agent continues with next edits

7. Agent finishes all changes
      -> Runner flushes any remaining accumulated edits
      -> Final diff approval round for last file
      -> Runner sends result: {success: true, changes_made: true}
      -> Runner sends status: "completed"

8a. Frontend: send {"action": "save"}
      -> Local: copies volume back to host filesystem
      -> GitHub: pushes branch, creates PR, returns URL
      -> Sends save_result to frontend

8b. Frontend: send {"action": "discard"}
      -> Clears both Docker volumes
```

---

## Error handling

| Scenario | Handling |
|---|---|
| Agent subprocess failure | Returns `StylerResult(success=False)`, runner terminates with error status. If some changes were already approved, they're preserved. |
| Codebase copy failure | Runner terminates with user-facing error message |
| Claude CLI not found | Runner terminates with error |
| WebSocket disconnect | Runner detaches (keeps running). Reconnecting client gets message replay. |
| Diff approval timeout | Hook returns `False` (rejected) after 300 seconds |
| GitHub API 422 | Fetches existing PR URL instead of creating a new one |
| Docker errors | Caught and logged at each operation level |
| Cancelled operation | `CancelledError` raised at checkpoints, `pkill` sent to agent process |

---

## Security

- **API key authentication** on all HTTP endpoints and WebSocket connections
- **Non-root execution**: agent runs as user `agent` inside the container
- **CORS** restricted to `http://localhost:3000`
- **GitHub tokens** are used to construct authenticated clone URLs but are not logged
- **Docker socket** is mounted into both containers (required for Docker-in-Docker operations)
- **Read-only host mount**: the host projects directory is mounted as read-only; modifications happen inside Docker volumes and are only written back during explicit save
