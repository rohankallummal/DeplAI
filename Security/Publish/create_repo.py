import logging
import re

import requests

from utils import get_docker_client, decode_output, CODEBASE_VOLUME
from Publish.github_user import get_github_user_identity, github_headers

logger = logging.getLogger(__name__)


def _sanitize_repo_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "-", name).strip("-")


def create_repo(
    project_id: str,
    project_name: str,
    token: str,
    owner: str,
) -> tuple[bool, str, str | None]:
    repo_name = _sanitize_repo_name(f"{project_name}-{project_id}")
    headers = github_headers(token)

    repo_payload = {"name": repo_name, "private": False, "auto_init": False}
    repo_data = None

    resp = requests.post(
        "https://api.github.com/user/repos",
        headers=headers,
        json=repo_payload,
        timeout=30,
    )

    if resp.status_code == 201:
        repo_data = resp.json()
    else:
        user_error = resp.json().get("message", resp.text)
        user_status = resp.status_code
        logger.error(
            "POST /user/repos failed — status=%d body=%s token_prefix=%s owner=%s",
            user_status, resp.text[:500], token[:8] + "...", owner,
        )

        resp2 = requests.post(
            f"https://api.github.com/orgs/{owner}/repos",
            headers=headers,
            json=repo_payload,
            timeout=30,
        )

        if resp2.status_code == 201:
            repo_data = resp2.json()
        else:
            logger.error(
                "POST /orgs/%s/repos failed — status=%d body=%s",
                owner, resp2.status_code, resp2.text[:500],
            )

            if user_status == 403:
                return (
                    False,
                    f"GitHub returned 403: {user_error}. "
                    "Ensure you authorized the 'repo' scope when prompted.",
                    None,
                )
            return (False, f"Failed to create repository ({user_status}): {user_error}", None)

    if repo_data is None:
        return (False, "Failed to create repository", None)

    repo_url = repo_data["html_url"]
    full_name = repo_data["full_name"]
    clone_url = f"https://x-access-token:{token}@github.com/{full_name}.git"

    logger.info("Created GitHub repository %s", full_name)

    user_name, user_email = get_github_user_identity(token, owner)

    script = " && ".join([
        "git config --global --add safe.directory /repo",
        "cd /repo",
        "rm -rf .git",
        f'git config --global user.email "{user_email}"',
        f'git config --global user.name "{user_name}"',
        "git init -b main",
        "git add .",
        'git commit -m "remediated codebase"',
        f"git remote add origin {clone_url}",
        "git push -u origin main",
    ])

    client = get_docker_client()
    try:
        container = client.containers.run(
            "alpine/git",
            entrypoint="sh",
            command=["-c", script],
            volumes={CODEBASE_VOLUME: {"bind": "/repo", "mode": "rw"}},
            tmpfs={"/git": ""},
            detach=True,
        )
        result = container.wait(timeout=120)
        logs = decode_output(container.logs())
        container.remove(v=True)

        if result.get("StatusCode", -1) != 0:
            logger.error("Git push failed: %s", logs)
            return (False, f"Failed to push code to repository: {logs}", repo_url)
    except Exception as e:
        logger.error("Docker error during push: %s", e)
        return (False, f"Failed to push code: {e}", repo_url)

    logger.info("Pushed remediated codebase to %s", full_name)
    return (True, "Repository created and code pushed successfully", repo_url)
