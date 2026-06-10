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
      default_branch,
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
          { error: 'GitHub App installation is suspended. Unsuspend before customizing.' },
          { status: 403 }
        );
      }

      try {
        const token = await githubService.getInstallationToken(installation_id);
        backendPayload.github_token = token;
        backendPayload.repository_url = `https://github.com/${owner}/${repo}`;
        backendPayload.owner = owner;
        backendPayload.repo = repo;
        backendPayload.default_branch = default_branch || 'main';
      } catch (err) {
        console.error('Failed to get GitHub token:', err);
        return NextResponse.json(
          { error: 'Failed to authenticate with GitHub. The installation may be suspended or removed.' },
          { status: 403 }
        );
      }
    } else {
      const ownershipCheck = await verifyProjectOwnership(user.id, project_id);
      if (ownershipCheck.error) return ownershipCheck.error;
    }

    const response = await fetch(`${CUSTOMIZE_URL}/api/customize/validate`, {
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
    logCustomizeError('Customize', err);
    if (isConnectionRefused(err)) return customizeUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to validate customization' },
      { status: 500 }
    );
  }
}
