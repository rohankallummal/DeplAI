import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

NON_EXPIRING_TTL = 24 * 60 * 60

_store: dict[str, dict] = {}


def store_token(
    user_id: str,
    token: str,
    refresh_token: str | None = None,
    expires_in: int | None = None,
) -> None:
    _store[user_id] = {
        "token": token,
        "refresh_token": refresh_token,
        "expires_at": time.time() + (expires_in or NON_EXPIRING_TTL),
    }


def get_token(user_id: str) -> str | None:
    entry = _store.get(user_id)
    if entry is None:
        return None

    if time.time() < entry["expires_at"]:
        return entry["token"]

    if entry.get("refresh_token"):
        refreshed = _refresh(user_id, entry["refresh_token"])
        if refreshed:
            return refreshed

    _store.pop(user_id, None)
    return None


def has_valid_token(user_id: str) -> bool:
    return get_token(user_id) is not None


def remove_token(user_id: str) -> None:
    _store.pop(user_id, None)


def clear_all() -> None:
    _store.clear()


def _refresh(user_id: str, refresh_token: str) -> str | None:
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        logger.warning("Cannot refresh: GITHUB_CLIENT_ID/SECRET not set")
        return None

    try:
        resp = requests.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            data = resp.json()
            if "access_token" in data:
                store_token(
                    user_id,
                    data["access_token"],
                    data.get("refresh_token", refresh_token),
                    data.get("expires_in"),
                )
                return data["access_token"]
    except Exception as e:
        logger.warning("Token refresh failed for user %s: %s", user_id, e)

    return None
