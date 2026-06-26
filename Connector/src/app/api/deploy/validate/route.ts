import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
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
      installation_id,
      owner,
      repo,
    } = body;

    const ownership = await verifyAnyProjectAccess(user.id, project_id);
    if (ownership.error) return ownership.error;

    const backendPayload: Record<string, unknown> = {
      project_id,
      project_name,
      project_type,
      user_id: user.id,
    };

    if (project_type === 'github' && owner && repo) {
      try {
        const token = await githubService.getInstallationToken(installation_id);
        backendPayload.github_token = token;
        backendPayload.repository_url = `https://github.com/${owner}/${repo}`;
      } catch (err) {
        console.error('Failed to get GitHub token:', err);
        return NextResponse.json(
          { error: 'Failed to authenticate with GitHub.' },
          { status: 403 }
        );
      }
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
