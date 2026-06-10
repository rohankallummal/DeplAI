import logging

import requests

from utils import get_docker_client, decode_output, CODEBASE_VOLUME
from Publish.github_user import get_github_user_identity, github_headers

logger = logging.getLogger(__name__)

PR_BODY = """\
## DEPLAI Security Remediation

This pull request contains automated security vulnerability fixes applied by DEPLAI.
"""


def create_pr(
    project_id: str,
    token: str,
    owner: str,
    repo: str,
    default_branch: str = "main",
) -> tuple[bool, str, str | None]:
    branch_name = f"deplai/remediation-{project_id}"
    clone_url = f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"

    user_name, user_email = get_github_user_identity(token, owner)

    script = " && ".join([
        "git config --global --add safe.directory /repo",
        "cd /repo",
        f'git config user.email "{user_email}"',
        f'git config user.name "{user_name}"',
        f"git branch -D {branch_name} 2>/dev/null || true",
        f"git checkout -b {branch_name}",
        "git add .",
        'git diff --cached --quiet && echo "NO_CHANGES" && exit 0 || true',
        'git commit -m "fix: remediate security vulnerabilities"',
        f"git remote set-url origin {clone_url}",
        f"git push --force origin {branch_name}",
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

        if "NO_CHANGES" in logs:
            return (False, "No changes to commit — the codebase is unchanged", None)

        if result.get("StatusCode", -1) != 0:
            logger.error("Git push failed: %s", logs)
            return (False, f"Failed to push branch: {logs}", None)
    except Exception as e:
        logger.error("Docker error during push: %s", e)
        return (False, f"Failed to push branch: {e}", None)

    logger.info("Pushed branch %s to %s/%s", branch_name, owner, repo)
    headers = github_headers(token)

    resp = requests.post(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        headers=headers,
        json={
            "title": "fix: DEPLAI security remediation",
            "body": PR_BODY,
            "head": branch_name,
            "base": default_branch,
        },
        timeout=30,
    )

    repo_url = f"https://github.com/{owner}/{repo}"

    if resp.status_code == 201:
        pr_url = resp.json()["html_url"]
        logger.info("Created PR: %s", pr_url)
        return (True, "Pull request created successfully", pr_url)

    if resp.status_code == 422:
        existing = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/pulls",
            headers=headers,
            params={"head": f"{owner}:{branch_name}", "state": "open"},
            timeout=15,
        )
        if existing.ok and existing.json():
            pr_url = existing.json()[0]["html_url"]
            logger.info("PR already exists: %s", pr_url)
            return (True, "Pull request already exists", pr_url)

    logger.warning("PR API failed (status %d), but branch was pushed successfully", resp.status_code)
    return (True, "Branch pushed successfully", repo_url)
