#!/usr/bin/env python3
"""Gate daemon for per-edit review.

Each Edit tool call (PreToolUse) registers a "gate" keyed by an incrementing
request id. The gate stays `pending` until the user approves or rejects it (the
runner forwards the decision via `decide`). The PreToolUse hook blocks the agent
by polling `poll` until the gate resolves, so edits are reviewed one at a time
before they apply.

Two flags short-circuit the gate to auto-approve (the agent runs without
blocking): `grant_all` is the user's session-wide "apply everything" choice, and
`bypass` is set by the runner around the builder phase (whose edits must not be
gated).
"""
import json
import os
import signal
import socket
import sys

BASE = "/workspace/work"
SOCK_PATH = os.path.join(BASE, "hook.sock")
CONTEXT = 3
PREVIEW_LINES = 50

_gates: dict[int, dict] = {}   # request_id -> {request_id, file_path, hunks, decision, emitted}
_next_id = 0
_grant_all = False
_bypass = False


def _locate_block(file_lines: list[str], old_s: str) -> int:
    """Return the 0-based start line where old_s occurs, or -1.

    First tries an exact substring match (fast, precise). If that fails —
    which happens whenever the Edit tool matched old_string whitespace-
    tolerantly rather than byte-exactly — fall back to comparing line blocks
    ignoring each line's leading/trailing whitespace, so we still anchor the
    hunk at the right place."""
    if not old_s:
        return -1
    file_content = "\n".join(file_lines)
    pos = file_content.find(old_s)
    if pos >= 0:
        return file_content[:pos].count("\n")
    old_lines = old_s.split("\n")
    target = [l.strip() for l in old_lines]
    window = len(old_lines)
    for i in range(0, len(file_lines) - window + 1):
        if all(file_lines[i + j].strip() == target[j] for j in range(window)):
            return i
    return -1


def build_hunk(fp: str, old_s: str, new_s: str) -> dict:
    try:
        with open(fp) as f:
            file_lines = f.read().split("\n")
    except Exception:
        file_lines = None

    old_lines = old_s.split("\n") if old_s else []
    new_lines = new_s.split("\n") if new_s else []
    start_line = _locate_block(file_lines, old_s) if file_lines is not None else -1

    lines: list = []
    if start_line >= 0:
        # Anchored: real context around the edit, using the file's own text for
        # context and deletions (truthful even when old_s drifted on whitespace).
        ctx_start = max(0, start_line - CONTEXT)
        for i in range(ctx_start, start_line):
            lines.append({"type": "ctx", "num": i + 1, "text": file_lines[i]})
        end_old = start_line + len(old_lines)
        for i in range(start_line, min(end_old, len(file_lines))):
            lines.append({"type": "del", "num": i + 1, "text": file_lines[i]})
        for i, text in enumerate(new_lines):
            lines.append({"type": "add", "num": start_line + i + 1, "text": text})
        end_new = start_line + len(new_lines)
        ctx_end = min(len(file_lines), end_old + CONTEXT)
        for i in range(end_old, ctx_end):
            lines.append({"type": "ctx", "num": end_new + (i - end_old) + 1, "text": file_lines[i]})
    else:
        # Unanchorable (file unreadable or block not found even tolerantly):
        # still show the edit so the box is never empty. No context/real line
        # numbers are available, so number sequentially from 1.
        for i, text in enumerate(old_lines):
            lines.append({"type": "del", "num": i + 1, "text": text})
        for i, text in enumerate(new_lines):
            lines.append({"type": "add", "num": i + 1, "text": text})
    return {"lines": lines}


def build_write_preview(content: str) -> tuple[dict, int]:
    """Preview for a Write: the first PREVIEW_LINES lines of the new content as
    additions, plus the count of lines beyond the preview (for the "... additional
    lines omitted" notice)."""
    lines = content.split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]   # drop the empty element a trailing newline produces
    preview = lines[:PREVIEW_LINES]
    omitted = max(0, len(lines) - PREVIEW_LINES)
    hunk = {"lines": [{"type": "add", "num": i + 1, "text": text} for i, text in enumerate(preview)]}
    return hunk, omitted


def _has_changes(hunk: dict) -> bool:
    return any(l.get("type") in ("add", "del") for l in hunk.get("lines", []))


def handle_gate(data: dict) -> dict:
    """Register a gate and return its request id. Edits build an old/new hunk;
    Writes build a content preview (new file or overwrite). Auto-approves when a
    short-circuit flag is set or when there is nothing to review."""
    global _next_id
    tool_name = data.get("tool_name", "Edit")
    tool_input = data.get("tool_input", {})
    fp = tool_input.get("file_path", "")

    new_file = overwrite = False
    omitted = 0
    if tool_name == "Write":
        hunk, omitted = build_write_preview(tool_input.get("content", ""))
        new_file = not os.path.exists(fp)
        overwrite = not new_file
    else:
        hunk = build_hunk(fp, tool_input.get("old_string", ""), tool_input.get("new_string", ""))

    _next_id += 1
    rid = _next_id
    auto = _grant_all or _bypass or not _has_changes(hunk)
    _gates[rid] = {
        "request_id": rid,
        "file_path": fp,
        "hunks": [hunk],
        "decision": "approved" if auto else "pending",
        "emitted": False,
        "new_file": new_file,
        "overwrite": overwrite,
        "omitted": omitted,
    }
    return {"request_id": rid}


def handle_poll(data: dict) -> dict:
    """Return the current decision for a gate. Unknown ids resolve to rejected so
    a stale poll (e.g. after a reset) never wedges the agent indefinitely."""
    rid = data.get("request_id")
    gate = _gates.get(rid)
    if gate is None:
        return {"decision": "rejected"}
    if (_grant_all or _bypass) and gate["decision"] == "pending":
        gate["decision"] = "approved"
    return {"decision": gate["decision"]}


def handle_decide(data: dict) -> dict:
    rid = data.get("request_id")
    approved = bool(data.get("approved", False))
    gate = _gates.get(rid)
    if gate is not None and gate["decision"] == "pending":
        gate["decision"] = "approved" if approved else "rejected"
    return {"status": "ok"}


def _approve_pending() -> None:
    """Release every still-pending gate (used when a short-circuit flag turns on)."""
    for gate in _gates.values():
        if gate["decision"] == "pending":
            gate["decision"] = "approved"


def handle_grant_all() -> dict:
    global _grant_all
    _grant_all = True
    _approve_pending()
    return {"status": "ok"}


def handle_bypass(data: dict) -> dict:
    """Runner-controlled auto-approve, set around the builder phase so its edits
    apply without surfacing reviewable boxes."""
    global _bypass
    _bypass = bool(data.get("on", False))
    if _bypass:
        _approve_pending()
    return {"status": "ok"}


def handle_list_pending() -> dict:
    """Return gates the runner has not seen yet (marking them emitted), so each
    edit surfaces as exactly one diff box."""
    out = []
    for gate in _gates.values():
        if not gate["emitted"]:
            gate["emitted"] = True
            out.append({
                "request_id": gate["request_id"],
                "file_path": gate["file_path"],
                "hunks": gate["hunks"],
                "decision": gate["decision"],
                "new_file": gate.get("new_file", False),
                "overwrite": gate.get("overwrite", False),
                "omitted": gate.get("omitted", 0),
            })
    return {"gates": out}


def handle_reset() -> None:
    """Clear gates between iterations. `grant_all` is intentionally preserved —
    it is the user's session-wide choice."""
    global _gates, _next_id
    _gates = {}
    _next_id = 0


def run_server() -> None:
    os.makedirs(BASE, exist_ok=True)

    try:
        os.remove(SOCK_PATH)
    except FileNotFoundError:
        pass

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCK_PATH)
    os.chmod(SOCK_PATH, 0o777)
    server.listen(16)

    def shutdown(_signum, _frame):
        server.close()
        try:
            os.remove(SOCK_PATH)
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        conn, _ = server.accept()
        try:
            chunks: list[bytes] = []
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)

            data = json.loads(raw) if raw else {}
            action = data.get("action")

            if action == "gate":
                resp = handle_gate(data)
            elif action == "poll":
                resp = handle_poll(data)
            elif action == "decide":
                resp = handle_decide(data)
            elif action == "grant_all":
                resp = handle_grant_all()
            elif action == "bypass":
                resp = handle_bypass(data)
            elif action == "list_pending":
                resp = handle_list_pending()
            elif action == "reset":
                handle_reset()
                resp = {"status": "ok"}
            else:
                resp = {"status": "ok"}

            conn.sendall(json.dumps(resp).encode())
        except Exception:
            try:
                conn.sendall(b'{"status":"ok"}')
            except Exception:
                pass
        finally:
            conn.close()


if __name__ == "__main__":
    run_server()
