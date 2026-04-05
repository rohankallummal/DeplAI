import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyProjectOwnership } from '@/lib/auth';
import { DEPLOY_URL, deployHeaders } from '@/lib/deploy';

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const ownership = await verifyProjectOwnership(user.id, project_id);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${DEPLOY_URL}/api/deploy/destroy`, {
      method: 'POST',
      headers: deployHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ project_id }),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Deploy destroy error:', err);
    return NextResponse.json(
      { error: 'Failed to destroy deployment' },
      { status: 500 }
    );
  }
}
