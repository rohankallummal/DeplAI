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


def build_hunk(fp: str, old_s: str, new_s: str) -> dict:
    lines: list = []
    try:
        with open(fp) as f:
            file_lines = f.read().split("\n")
        file_content = "\n".join(file_lines)
        pos = file_content.find(old_s)
        if pos >= 0:
            start_line = file_content[:pos].count("\n")
            old_lines = old_s.split("\n") if old_s else []
            new_lines = new_s.split("\n") if new_s else []

            ctx_start = max(0, start_line - CONTEXT)
            for i in range(ctx_start, start_line):
                lines.append({"type": "ctx", "num": i + 1, "text": file_lines[i]})
            for i, text in enumerate(old_lines):
                lines.append({"type": "del", "num": start_line + i + 1, "text": text})
            for i, text in enumerate(new_lines):
                lines.append({"type": "add", "num": start_line + i + 1, "text": text})
            end_old = start_line + len(old_lines)
            end_new = start_line + len(new_lines)
            ctx_end = min(len(file_lines), end_old + CONTEXT)
            for i in range(end_old, ctx_end):
                lines.append({"type": "ctx", "num": end_new + (i - end_old) + 1, "text": file_lines[i]})
    except Exception:
        pass
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


def handle_peek() -> dict:
    return {
        "files": [
            {
                "file_path": fp,
                "hunks": hunks,
                "backup": _file_backups.get(fp),
                "rev": _file_rev.get(fp, 0),
            }
            for fp, hunks in _files.items()
        ],
    }


def handle_get_state() -> dict:
    global _files, _file_backups, _file_rev
    state = {
        "files": [
            {
                "file_path": fp,
                "hunks": hunks,
                "backup": _file_backups.get(fp),
            }
            for fp, hunks in _files.items()
        ],
    }
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
