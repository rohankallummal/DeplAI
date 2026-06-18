FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc git curl socat inotify-tools \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd -m -s /bin/bash agent

RUN mkdir -p /home/agent/.claude && \
    printf '{"ackTos":true,"hooks":{"PreToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"python3 /app/hooks/diff_gate.py","timeout":1860}]}]}}\n' \
    > /home/agent/.claude/settings.json && \
    chown -R agent:agent /home/agent/.claude

COPY . .

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
