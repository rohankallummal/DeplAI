import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess, verifyRepositoryOwnership } from '@/lib/auth';
import { githubService } from '@/lib/github';
import { DEPLOY_URL, deployHeaders, logDeployError, isConnectionRefused, deployUnavailableResponse } from '@/lib/deploy';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const {
      project_id,
      project_name,
      project_type,
      owner,
      repo,
    } = body;

    const backendPayload: Record<string, unknown> = {
      project_id,
      project_name,
      project_type,
      user_id: user.id,
    };

    if (project_type === 'github' && owner && repo) {
      const repoOwnership = await verifyRepositoryOwnership(user.id, owner, repo);
      if (!repoOwnership) {
        return NextResponse.json({ error: 'Repository not found or access denied' }, { status: 403 });
      }
      if (repoOwnership.suspended) {
        return NextResponse.json(
          { error: 'GitHub App installation is suspended. Unsuspend before deploying.' },
          { status: 403 }
        );
      }

      try {
        const token = await githubService.getInstallationToken(repoOwnership.installationId);
        backendPayload.github_token = token;
        backendPayload.repository_url = `https://github.com/${owner}/${repo}`;
      } catch (err) {
        console.error('Failed to get GitHub token:', err);
        return NextResponse.json(
          { error: 'Failed to authenticate with GitHub. The installation may be suspended or removed.' },
          { status: 403 }
        );
      }
    } else {
      const ownership = await verifyAnyProjectAccess(user.id, project_id);
      if (ownership.error) return ownership.error;
    }

    const response = await fetch(`${DEPLOY_URL}/api/deploy/validate`, {
      method: 'POST',
      headers: deployHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(backendPayload),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    logDeployError('Deploy', err);
    if (isConnectionRefused(err)) return deployUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to validate deploy' },
      { status: 500 }
    );
  }
}
