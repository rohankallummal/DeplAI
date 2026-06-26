import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, type Row } from '@/lib/db';
import { SECURITY_URL, securityHeaders, logSecurityError, isConnectionRefused, securityUnavailableResponse } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { project_id, owner, repo } = await request.json();

    if (!project_id || !owner || !repo) {
      return NextResponse.json(
        { error: 'project_id, owner, and repo are required' },
        { status: 400 }
      );
    }

    const [repoRow] = await query<Row[]>(
      'SELECT default_branch FROM github_repositories WHERE full_name = ?',
      [`${owner}/${repo}`]
    );
    const defaultBranch = repoRow?.default_branch || 'main';

    const response = await fetch(`${SECURITY_URL}/api/publish/create-pr`, {
      method: 'POST',
      headers: securityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        project_id,
        user_id: user.id,
        owner,
        repo,
        default_branch: defaultBranch,
      }),
    });

    const data = await response.json();

    if (response.status === 401) {
      return NextResponse.json(
        { error: 'GitHub authorization required', auth_required: true },
        { status: 401 }
      );
    }

    if (!response.ok) {
      const msg = typeof data.detail === 'string'
        ? data.detail
        : 'Failed to create pull request';
      return NextResponse.json(
        { error: msg },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    logSecurityError('Publish create-pr', error);
    if (isConnectionRefused(error)) return securityUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to create pull request' },
      { status: 500 }
    );
  }
}
