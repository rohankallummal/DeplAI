import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
import { SECURITY_URL, securityHeaders, logSecurityError, securityUnavailableResponse } from '@/lib/security';
import { isConnectionRefused } from '@/lib/backend';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    // Authorize: only the project's owner may pull its vulnerability report.
    const ownership = await verifyAnyProjectAccess(user.id, projectId);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${SECURITY_URL}/api/security/report-pdf/${projectId}`, {
      headers: securityHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: text || 'Failed to generate vulnerability report' },
        { status: response.status }
      );
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="vulnerability-report.pdf"',
      },
    });
  } catch (err) {
    logSecurityError('Report PDF proxy', err);
    if (isConnectionRefused(err)) return securityUnavailableResponse();
    return NextResponse.json({ error: 'Failed to get vulnerability report' }, { status: 500 });
  }
}
