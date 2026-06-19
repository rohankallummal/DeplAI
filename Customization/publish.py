import logging
import os

import requests

from utils import get_docker_client, decode_output, CUSTOMIZE_CODE_VOLUME

logger = logging.getLogger(__name__)

PR_BODY = """## DeplAI Frontend Customization

This pull request contains UI changes applied by DeplAI's customization agent.
"""


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


def _run_and_cleanup(**run_kwargs) -> tuple[dict, str]:
    container = get_docker_client().containers.run(detach=True, **run_kwargs)
    try:
        result = container.wait()
        logs = decode_output(container.logs())
    finally:
        try:
            container.remove(force=True)
        except Exception:
            pass
    return result, logs


def save_local_changes(project_id: str, user_id: str) -> tuple[bool, str]:
    host_base = os.environ.get("HOST_PROJECTS_DIR")
    if host_base:
        host_path = os.path.join(host_base, user_id, project_id)
    else:
        host_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__), "..", "Connector", "tmp",
                "local-projects", user_id, project_id,
            )
        )

    # Overlay the modified/created files (additive), then apply the recorded
    # deletions. cp -a can only add/overwrite, so deletions must be replayed
    # explicitly. Each path is validated before rm -f: absolute paths and any
    # path containing ".." are rejected outright, and the resolved target must
    # still live inside /dst (defense against a corrupted .deletions manifest).
    save_script = (
        f"cp -a /vol/codebase/{project_id}/original/. /dst/ 2>/dev/null; "
        f"deletions=/vol/codebase/{project_id}/.deletions; "
        'if [ -f "$deletions" ]; then '
        'root=$(realpath /dst); '
        'while IFS= read -r f; do '
        '[ -z "$f" ] && continue; '
        'case "$f" in /*) continue ;; esac; '
        'case "$f" in *..*) continue ;; esac; '
        'real=$(realpath "/dst/$f" 2>/dev/null) || continue; '
        'case "$real" in "$root"|"$root"/*) rm -f "$real" ;; esac; '
        'done < "$deletions"; '
        'fi; '
        'echo Success'
    )

    try:
        _, logs = _run_and_cleanup(
            image="alpine",
            command=["sh", "-c", save_script],
            volumes={
                CUSTOMIZE_CODE_VOLUME: {"bind": "/vol", "mode": "ro"},
                host_path: {"bind": "/dst", "mode": "rw"},
            },
        )
        if "Success" in logs:
            logger.info("Local changes saved for project %s", project_id)
            return (True, "Changes saved successfully")
        return (False, f"Copy failed: {logs}")
    except Exception as e:
        logger.error("Failed to save local changes: %s", e)
        return (False, str(e))


def create_customize_pr(
    project_id: str,
    token: str,
    owner: str,
    repo: str,
    branch_name: str,
    base_branch: str = "main",
) -> tuple[bool, str, str | None]:
    clone_url = f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"

    user_name, user_email = get_github_user_identity(token, owner)

    script = " && ".join([
        f"git config --global --add safe.directory /repo/codebase/{project_id}",
        f"cd /repo/codebase/{project_id}",
        f'git config user.email "{user_email}"',
        f'git config user.name "{user_name}"',
        f"git checkout {branch_name} 2>/dev/null || git checkout -b {branch_name}",
        "git add .",
        'git diff --cached --quiet && echo "NO_CHANGES" && exit 0 || true',
        'git commit -m "feat: UI customization applied by DeplAI"',
        f"git remote set-url origin {clone_url}",
        f"git push --force origin {branch_name}",
    ])

    try:
        result, logs = _run_and_cleanup(
            image="alpine/git",
            entrypoint="sh",
            command=["-c", script],
            volumes={CUSTOMIZE_CODE_VOLUME: {"bind": "/repo", "mode": "rw"}},
            tmpfs={"/git": ""},
        )

        if "NO_CHANGES" in logs:
            return (False, "No changes to commit", None)

        if result.get("StatusCode", -1) != 0:
            logger.error("Git push failed: %s", logs)
            return (False, f"Failed to push branch: {logs}", None)
    except Exception as e:
        logger.error("Docker error during push: %s", e)
        return (False, f"Failed to push branch: {e}", None)

    logger.info("Pushed branch %s to %s/%s", branch_name, owner, repo)
    headers = github_headers(token)
    pulls_url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    repo_url = f"https://github.com/{owner}/{repo}"

    # Find-or-create: an open PR for this head already exists when continuing an
    # existing customization, so reuse it instead of attempting a (doomed) create.
    existing = requests.get(
        pulls_url,
        headers=headers,
        params={"head": f"{owner}:{branch_name}", "state": "open"},
        timeout=15,
    )
    if existing.ok and existing.json():
        pr_url = existing.json()[0]["html_url"]
        logger.info("Reusing existing PR: %s", pr_url)
        return (True, "Pull request already exists", pr_url)

    resp = requests.post(
        pulls_url,
        headers=headers,
        json={
            "title": "feat: DeplAI UI customization",
            "body": PR_BODY,
            "head": branch_name,
            "base": base_branch,
        },
        timeout=30,
    )

    if resp.status_code == 201:
        pr_url = resp.json()["html_url"]
        logger.info("Created PR: %s", pr_url)
        return (True, "Pull request created successfully", pr_url)

    # Defensive fallback: a race could still surface 422 (PR created meanwhile).
    if resp.status_code == 422:
        existing = requests.get(
            pulls_url,
            headers=headers,
            params={"head": f"{owner}:{branch_name}", "state": "open"},
            timeout=15,
        )
        if existing.ok and existing.json():
            pr_url = existing.json()[0]["html_url"]
            logger.info("PR already exists: %s", pr_url)
            return (True, "Pull request already exists", pr_url)

    logger.warning("PR API failed (status %d), but branch was pushed", resp.status_code)
    return (True, "Branch pushed successfully", repo_url)
