#!/bin/bash
socat -t310 - UNIX-CONNECT:/workspace/work/hook.sock 2>/dev/null || true
exit 0
