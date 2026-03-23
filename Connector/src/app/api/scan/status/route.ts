import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyProjectOwnership } from '@/lib/auth';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const projectId = request.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const ownership = await verifyProjectOwnership(user.id, projectId);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${SECURITY_URL}/api/scan/status/${projectId}`, {
      headers: securityHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ status: 'not_initiated' });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Scan status error:', error);
    return NextResponse.json({ status: 'not_initiated' });
  }
}
