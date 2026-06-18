#!/usr/bin/env python3

import hashlib
import json
import os
import shutil
import signal
import socket
import sys

BASE = "/workspace/work"
SOCK_PATH = os.path.join(BASE, "hook.sock")
BACKUPS_DIR = os.path.join(BASE, "backups")
CONTEXT = 3

_files: dict[str, list] = {}
_file_backups: dict[str, str] = {}
_file_rev: dict[str, int] = {}


def _backup_path_for(file_path: str) -> str:
    return os.path.join(BACKUPS_DIR, hashlib.md5(file_path.encode()).hexdigest())


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


def handle_edit(data: dict) -> None:
    tool_input = data.get("tool_input", data)
    file_path = tool_input.get("file_path", "")
    old_string = tool_input.get("old_string", "")
    new_string = tool_input.get("new_string", "")

    if not file_path:
        return

    if file_path not in _files:
        try:
            os.makedirs(BACKUPS_DIR, exist_ok=True)
            backup_path = _backup_path_for(file_path)
            shutil.copy2(file_path, backup_path)
            _file_backups[file_path] = backup_path
        except Exception:
            pass
        _files[file_path] = []

    hunk = build_hunk(file_path, old_string, new_string)
    _files[file_path].append(hunk)
    _file_rev[file_path] = _file_rev.get(file_path, 0) + 1


def _file_entry(fp: str, hunks: list, include_rev: bool) -> dict:
    entry = {"file_path": fp, "hunks": hunks, "backup": _file_backups.get(fp)}
    if include_rev:
        entry["rev"] = _file_rev.get(fp, 0)
    return entry


def handle_peek() -> dict:
    return {"files": [_file_entry(fp, hunks, include_rev=True) for fp, hunks in _files.items()]}


def handle_get_state() -> dict:
    # Legacy destructive drain. `rev` is intentionally omitted from the payload:
    # the live poller uses the rev-aware handle_peek(), while get_state is only
    # the one-shot end-of-session drain where revision tracking no longer matters.
    global _files, _file_backups, _file_rev
    state = {"files": [_file_entry(fp, hunks, include_rev=False) for fp, hunks in _files.items()]}
    _files = {}
    _file_backups = {}
    _file_rev = {}
    return state


def handle_reset() -> None:
    global _files, _file_backups, _file_rev
    _files = {}
    _file_backups = {}
    _file_rev = {}


def run_server() -> None:
    os.makedirs(BASE, exist_ok=True)

    try:
        os.remove(SOCK_PATH)
    except FileNotFoundError:
        pass

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCK_PATH)
    os.chmod(SOCK_PATH, 0o777)
    server.listen(5)

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

            if not raw:
                conn.sendall(b'{"status":"ok"}')
                continue

            data = json.loads(raw)
            action = data.get("action")

            if action == "peek":
                state = handle_peek()
                conn.sendall(json.dumps(state).encode())
            elif action == "get_state":
                state = handle_get_state()
                conn.sendall(json.dumps(state).encode())
            elif action == "reset":
                handle_reset()
                conn.sendall(b'{"status":"ok"}')
            else:
                handle_edit(data)
                conn.sendall(b'{"status":"ok"}')
        except Exception:
            try:
                conn.sendall(b'{"status":"ok"}')
            except Exception:
                pass
        finally:
            conn.close()


if __name__ == "__main__":
    run_server()
