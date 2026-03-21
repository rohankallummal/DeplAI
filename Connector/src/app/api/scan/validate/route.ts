import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyRepositoryOwnership } from '@/lib/auth';
import { githubService } from '@/lib/github';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

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
          { error: 'GitHub App installation is suspended. Unsuspend before scanning.' },
          { status: 403 }
        );
      }

      try {
        const token = await githubService.getInstallationToken(installation_id);
        backendPayload.github_token = token;
        backendPayload.repository_url = `https://github.com/${owner}/${repo}`;
      } catch (error) {
        console.error('Failed to get GitHub token:', error);
        return NextResponse.json(
          { error: 'Failed to authenticate with GitHub. The installation may be suspended or removed.' },
          { status: 403 }
        );
      }
    }

    const response = await fetch(`${SECURITY_URL}/api/scan/validate`, {
      method: 'POST',
      headers: securityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(backendPayload),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Scan validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate scan' },
      { status: 500 }
    );
  }
}
