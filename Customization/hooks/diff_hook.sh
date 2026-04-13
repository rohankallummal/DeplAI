#!/bin/bash
# PreToolUse hook for Edit tool — forwards input to the diff daemon.
# The daemon holds state in memory and handles file-level approval.
# socat startup is ~2ms vs ~100-300ms for a Python interpreter.
# -t310 allows up to 310s for the daemon to block on user approval
# during file transitions (daemon TIMEOUT is 300s).
# Falls back to allowing the edit if the daemon is unavailable.
socat -t310 - UNIX-CONNECT:/workspace/customize/hook.sock 2>/dev/null || true
exit 0
