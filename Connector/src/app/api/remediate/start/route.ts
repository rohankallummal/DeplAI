import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { project_id } = await request.json();

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const ownership = await verifyAnyProjectAccess(user.id, project_id);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${SECURITY_URL}/api/remediate/validate`, {
      method: 'POST',
      headers: securityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ project_id }),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Remediation start error:', error);
    return NextResponse.json(
      { error: 'Failed to start remediation' },
      { status: 500 }
    );
  }
}
