import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
import { SECURITY_URL, securityHeaders, logSecurityError } from '@/lib/security';

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

    const response = await fetch(`${SECURITY_URL}/api/operations/status/${projectId}`, {
      headers: securityHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ scan: null, remediation: null, remediation_status: null });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logSecurityError('Operation status', error);
    return NextResponse.json({ scan: null, remediation: null, remediation_status: null });
  }
}
