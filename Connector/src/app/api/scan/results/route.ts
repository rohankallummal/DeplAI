import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

export async function GET(request: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const projectId = request.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

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
    console.error('Scan results error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch scan results' },
      { status: 500 }
    );
  }
}
