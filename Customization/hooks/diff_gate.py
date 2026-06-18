#!/usr/bin/env python3
"""PreToolUse(Edit) gate hook.

Registers the edit with the diff daemon, then blocks the agent by polling until
the user approves or rejects it, and emits the PreToolUse permission decision so
an approved edit applies and a rejected one is dropped (the agent is told to move
on). On infrastructure failure it fails open (lets the edit through) so the agent
is never wedged; only an explicit timeout fails closed.

The settings.json hook entry MUST set a `timeout` larger than TIMEOUT_SECONDS,
otherwise the CLI kills this hook before a slow review completes.
"""
import json
import socket
import sys
import time

SOCK_PATH = "/workspace/work/hook.sock"
POLL_INTERVAL = 0.3
TIMEOUT_SECONDS = 1800  # 30 min; keep below the settings.json hook timeout


def _request(payload: dict) -> dict:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(5)
    try:
        s.connect(SOCK_PATH)
        s.sendall(json.dumps(payload).encode())
        s.shutdown(socket.SHUT_WR)
        chunks: list[bytes] = []
        while True:
            b = s.recv(65536)
            if not b:
                break
            chunks.append(b)
    finally:
        s.close()
    return json.loads(b"".join(chunks) or b"{}")


def _decide(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,        # "allow" | "deny"
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # Can't read the hook input — fail open rather than wedge the agent.
        sys.exit(0)

    try:
        resp = _request({
            "action": "gate",
            "tool_name": payload.get("tool_name", ""),
            "tool_input": payload.get("tool_input", {}),
        })
        rid = resp.get("request_id")
    except Exception:
        sys.exit(0)  # daemon unreachable -> fail open
    if rid is None:
        sys.exit(0)

    deadline = time.time() + TIMEOUT_SECONDS
    while time.time() < deadline:
        try:
            decision = _request({"action": "poll", "request_id": rid}).get("decision", "pending")
        except Exception:
            time.sleep(POLL_INTERVAL)
            continue
        if decision == "approved":
            _decide("allow", "Approved by user.")
        if decision == "rejected":
            _decide("deny", "The user rejected this change. Do not retry it; "
                            "continue with the remaining changes.")
        time.sleep(POLL_INTERVAL)

    _decide("deny", "Review timed out; the change was not applied. Continue with the remaining changes.")


if __name__ == "__main__":
    main()
