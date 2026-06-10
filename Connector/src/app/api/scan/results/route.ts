import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
import { SECURITY_URL, securityHeaders, logSecurityError, isConnectionRefused, securityUnavailableResponse } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const projectId = request.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const ownership = await verifyAnyProjectAccess(user.id, projectId);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${SECURITY_URL}/api/scan/results/${projectId}`, {
      headers: securityHeaders(),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({ detail: 'Failed to fetch results' }));
      return NextResponse.json(
        { error: detail.detail || 'Failed to fetch scan results' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    logSecurityError('Scan results', error);
    if (isConnectionRefused(error)) return securityUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to fetch scan results' },
      { status: 500 }
    );
  }
}
