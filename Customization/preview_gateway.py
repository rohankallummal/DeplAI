"""Nginx reverse-proxy gateway for Live Preview.

A single `live-preview-gateway` (nginx:alpine) container publishes the only
host-facing preview port and proxies to the dev server running inside the
`customize-preview` container, resolved by Docker DNS over the shared network.
Config is injected via `docker exec` (no extra volume) so teardown is just
removing the container.
"""
import logging
import time

import requests

from utils import (
    get_docker_client,
    decode_output,
    PREVIEW_GATEWAY_NAME,
    PREVIEW_CONTAINER_NAME,
    PREVIEW_NETWORK,
    PREVIEW_HOST_PORT,
    remove_preview_gateway,
)

logger = logging.getLogger(__name__)

CONF_PATH = "/etc/nginx/conf.d/default.conf"


def holding_config() -> str:
    """Served until the dev-server port is known: a plain 503 so the iframe shows
    a clear 'starting' state rather than nginx's default welcome page."""
    return (
        "server {\n"
        "  listen 80;\n"
        "  location / {\n"
        "    add_header Content-Type text/plain;\n"
        "    return 503 'Preview is starting…';\n"
        "  }\n"
        "}\n"
    )


def upstream_config(port: int) -> str:
    """Proxy everything to customize-preview:<port> with WebSocket upgrade support
    (HMR) and a long read timeout for streamed/idle connections.

    `Connection` is set via a map so it is only `upgrade` for genuine WebSocket
    requests; normal navigations get `close`. Forcing `Connection: upgrade`
    unconditionally makes nginx mishandle keep-alive/chunked responses (e.g.
    Next.js dev), which strict clients like Chrome reject with
    ERR_INCOMPLETE_CHUNKED_ENCODING even though curl tolerates it. The `map`
    lives at http context — conf.d files are included inside nginx's http {}."""
    return (
        "map $http_upgrade $connection_upgrade {\n"
        "  default upgrade;\n"
        "  ''      close;\n"
        "}\n"
        "server {\n"
        "  listen 80;\n"
        "  location / {\n"
        f"    proxy_pass http://{PREVIEW_CONTAINER_NAME}:{port};\n"
        "    proxy_http_version 1.1;\n"
        "    proxy_set_header Upgrade $http_upgrade;\n"
        "    proxy_set_header Connection $connection_upgrade;\n"
        "    proxy_set_header Host $host;\n"
        "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
        "    proxy_read_timeout 86400;\n"
        "  }\n"
        "}\n"
    )


def _write_conf_and_reload(container, config: str) -> bool:
    # Heredoc keeps the config intact; `nginx -t` validates before reload so a bad
    # config is reported rather than silently ignored (an un-validated reload would
    # leave the holding 503 live while the caller believes it succeeded).
    script = (
        f"cat > {CONF_PATH} <<'NGINX_EOF'\n{config}\nNGINX_EOF\n"
        "nginx -t && nginx -s reload"
    )
    ec, out = container.exec_run(["sh", "-c", script])
    if ec != 0:
        logger.warning("Gateway config write/reload failed (%s): %s", ec, decode_output(out))
        return False
    return True


def ensure_gateway():
    """Create a fresh `live-preview-gateway` publishing the host port, serving the
    holding config. Any prior gateway is removed first so the host port is free
    and state is clean."""
    remove_preview_gateway()
    client = get_docker_client()
    container = client.containers.run(
        "nginx:alpine",
        name=PREVIEW_GATEWAY_NAME,
        ports={"80/tcp": PREVIEW_HOST_PORT},
        network=PREVIEW_NETWORK,
        detach=True,
    )
    # nginx starts with its default config; swap in the holding config + reload.
    _write_conf_and_reload(container, holding_config())
    logger.info("Live preview gateway ready on host port %s", PREVIEW_HOST_PORT)
    return container


def configure_gateway(port: int) -> bool:
    """Point the running gateway at the dev server's port and reload. Returns
    False if the gateway is missing or nginx rejected/failed the reload, so the
    caller never reports 'ready' over a gateway still serving the holding page."""
    try:
        container = get_docker_client().containers.get(PREVIEW_GATEWAY_NAME)
    except Exception as e:
        logger.error("Gateway not found while configuring upstream: %s", e)
        return False
    if not _write_conf_and_reload(container, upstream_config(port)):
        return False
    logger.info("Gateway upstream set to %s:%s", PREVIEW_CONTAINER_NAME, port)
    return True


def wait_until_serving(timeout: float = 20.0, interval: float = 0.4) -> bool:
    """Block until the gateway serves the upstream rather than the holding page.

    `nginx -s reload` is asynchronous: for a short window after configure_gateway
    the old workers still return the holding 503. The iframe is loaded the instant
    we signal `ready`, so without this gate it can fetch the holding page and stay
    stuck (it never retries). The gateway is reached by name over the shared
    network; a non-503 status means the upstream config is live. 502/504 (upstream
    momentarily unreachable) are also treated as 'past holding' and retried here."""
    url = f"http://{PREVIEW_GATEWAY_NAME}/"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status = requests.get(url, timeout=3).status_code
            if status not in (502, 503, 504):
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False
