import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { SECURITY_URL, securityHeaders, logSecurityError, isConnectionRefused, securityUnavailableResponse } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { project_id, project_name } = await request.json();

    if (!project_id || !project_name) {
      return NextResponse.json(
        { error: 'project_id and project_name are required' },
        { status: 400 }
      );
    }

    const response = await fetch(`${SECURITY_URL}/api/publish/create-repo`, {
      method: 'POST',
      headers: securityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        project_id,
        project_name,
        user_id: user.id,
        owner: user.login,
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
        : 'Failed to create repository';
      return NextResponse.json(
        { error: msg },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    logSecurityError('Publish create-repo', error);
    if (isConnectionRefused(error)) return securityUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to create repository' },
      { status: 500 }
    );
  }
}
