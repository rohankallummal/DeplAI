#!/usr/bin/env python3

import json
import os
import shutil
import signal
import socket
import sys
import time
import uuid

BASE = "/workspace/customize"
SOCK_PATH = os.path.join(BASE, "hook.sock")
PENDING = os.path.join(BASE, "pending_diff.json")
RESPONSE = os.path.join(BASE, "diff_response.json")
FILE_BACKUP = os.path.join(BASE, "file_backup")
TIMEOUT = 300
CONTEXT = 3

_current_file: str = ""
_accumulated_hunks: list = []


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


def hunk_sort_key(h: dict) -> int | float:
    for line in h.get("lines", []):
        if "num" in line:
            return line["num"]
    return float("inf")


def merge_overlapping_hunks(hunks: list) -> list:
    if len(hunks) <= 1:
        return hunks
    merged = [{"lines": list(hunks[0]["lines"])}]
    for hunk in hunks[1:]:
        prev = merged[-1]
        prev_lines = prev["lines"]
        curr_lines = list(hunk["lines"])
        if not prev_lines or not curr_lines:
            merged.append({"lines": curr_lines})
            continue
        prev_max = max(l["num"] for l in prev_lines)
        curr_min = min(l["num"] for l in curr_lines)
        if curr_min <= prev_max:
            curr_edit_nums = set(l["num"] for l in curr_lines if l["type"] != "ctx")
            trimmed_prev = [l for l in prev_lines if not (l["type"] == "ctx" and l["num"] in curr_edit_nums)]
            trimmed_curr = [l for l in curr_lines if not (l["type"] == "ctx" and l["num"] <= prev_max)]
            prev["lines"] = trimmed_prev + trimmed_curr
        else:
            merged.append({"lines": curr_lines})
    return merged


def send_and_wait(fp: str, hunks: list) -> bool:
    hunks = merge_overlapping_hunks(sorted(hunks, key=hunk_sort_key))

    for f in (PENDING, RESPONSE):
        try:
            os.remove(f)
        except FileNotFoundError:
            pass

    payload = {
        "diff_id": str(uuid.uuid4()),
        "file_path": fp,
        "hunks": hunks,
    }
    with open(PENDING, "w") as f:
        json.dump(payload, f)

    for _ in range(TIMEOUT * 2):
        if os.path.exists(RESPONSE):
            try:
                with open(RESPONSE) as f:
                    resp = json.load(f)
            except (json.JSONDecodeError, FileNotFoundError):
                resp = {}
            try:
                os.remove(RESPONSE)
            except Exception:
                pass
            try:
                os.remove(PENDING)
            except Exception:
                pass
            return resp.get("approved", False)
        time.sleep(0.5)

    try:
        os.remove(PENDING)
    except Exception:
        pass
    return False


def handle_edit(data: dict) -> None:
    global _current_file, _accumulated_hunks

    tool_input = data.get("tool_input", data)
    file_path = tool_input.get("file_path", "")
    old_string = tool_input.get("old_string", "")
    new_string = tool_input.get("new_string", "")

    if _current_file and _current_file != file_path:
        if _accumulated_hunks:
            approved = send_and_wait(_current_file, _accumulated_hunks)
            if not approved:
                try:
                    shutil.copy2(FILE_BACKUP, _current_file)
                except Exception:
                    pass
        _accumulated_hunks = []

    if _current_file != file_path:
        try:
            shutil.copy2(file_path, FILE_BACKUP)
        except Exception:
            pass
        _current_file = file_path

    hunk = build_hunk(file_path, old_string, new_string)
    _accumulated_hunks.append(hunk)


def handle_get_state() -> dict:
    global _current_file, _accumulated_hunks
    state = {
        "current_file": _current_file,
        "hunks": _accumulated_hunks,
    }
    _current_file = ""
    _accumulated_hunks = []
    return state


def handle_reset() -> None:
    global _current_file, _accumulated_hunks
    _current_file = ""
    _accumulated_hunks = []


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

            if action == "get_state":
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
