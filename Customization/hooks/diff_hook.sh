#!/bin/bash
socat -t310 - UNIX-CONNECT:/workspace/customize/hook.sock 2>/dev/null || true
exit 0
