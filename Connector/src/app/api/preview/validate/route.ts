import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyProjectOwnership, verifyRepositoryOwnership } from '@/lib/auth';
import { githubService } from '@/lib/github';
import { CUSTOMIZE_URL, customizeHeaders, logCustomizeError, isConnectionRefused, customizeUnavailableResponse } from '@/lib/customize';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const {
      project_id,
      project_name,
      project_type,
      installation_id,
      owner,
      repo,
      mode,
      base_branch,
      pr_number,
    } = body;

    const backendPayload: Record<string, any> = {
      project_id,
      project_name,
      project_type,
      user_id: user.id,
    };

    if (project_type === 'github' && owner && repo) {
      const ownership = await verifyRepositoryOwnership(user.id, owner, repo);
      if (!ownership) {
        return NextResponse.json({ error: 'Repository not found or access denied' }, { status: 403 });
      }
      if (ownership.suspended) {
        return NextResponse.json(
          { error: 'GitHub App installation is suspended. Unsuspend before previewing.' },
          { status: 403 }
        );
      }

      try {
        const token = await githubService.getInstallationToken(installation_id);
        backendPayload.github_token = token;
        backendPayload.repository_url = `https://github.com/${owner}/${repo}`;
        backendPayload.owner = owner;
        backendPayload.repo = repo;
      } catch (err) {
        console.error('Failed to get GitHub token:', err);
        return NextResponse.json(
          { error: 'Failed to authenticate with GitHub. The installation may be suspended or removed.' },
          { status: 403 }
        );
      }

      // Resolve the single branch to clone (read-only). `continue` previews the
      // customization PR's head branch; `new`/plain previews the chosen branch
      // as-is. The head_ref is resolved server-side (matched against this
      // project's DeplAI PRs) so the client cannot inject an arbitrary branch.
      const chosenBase = base_branch || 'main';
      if (mode === 'continue') {
        const prNumber = Number(pr_number);
        if (!Number.isInteger(prNumber)) {
          return NextResponse.json(
            { error: 'pr_number is required to preview an existing customization' },
            { status: 400 }
          );
        }
        const pulls = await githubService.getDeplaiPullsForBase(
          ownership.installationId, owner, repo, chosenBase, project_id
        );
        const match = pulls.find(p => p.number === prNumber);
        if (!match) {
          return NextResponse.json(
            { error: 'Selected customization PR was not found or is not eligible' },
            { status: 400 }
          );
        }
        backendPayload.branch = match.head_ref;
      } else {
        backendPayload.branch = chosenBase;
      }
    } else {
      const ownershipCheck = await verifyProjectOwnership(user.id, project_id);
      if (ownershipCheck.error) return ownershipCheck.error;
    }

    const response = await fetch(`${CUSTOMIZE_URL}/api/preview/validate`, {
      method: 'POST',
      headers: customizeHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(backendPayload),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    logCustomizeError('Preview', err);
    if (isConnectionRefused(err)) return customizeUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to validate preview' },
      { status: 500 }
    );
  }
}
