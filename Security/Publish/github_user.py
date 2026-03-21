import logging

import requests

logger = logging.getLogger(__name__)


def github_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def get_github_user_identity(token: str, owner: str) -> tuple[str, str]:
    try:
        resp = requests.get(
            f"https://api.github.com/users/{owner}",
            headers=github_headers(token),
            timeout=15,
        )

        if resp.status_code == 200:
            data = resp.json()
            name = data.get("name") or data.get("login") or owner
            email = data.get("email") or f"{owner}@users.noreply.github.com"
            return (name, email)
    except Exception as e:
        logger.warning("Failed to fetch GitHub user info for %s: %s", owner, e)

    return (owner, f"{owner}@users.noreply.github.com")
