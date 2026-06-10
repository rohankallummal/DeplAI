import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { DEPLOY_URL, deployHeaders, logDeployError, isConnectionRefused, deployUnavailableResponse } from '@/lib/deploy';

export async function GET(request: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const projectId = request.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const response = await fetch(`${DEPLOY_URL}/api/deploy/status/${projectId}`, {
      headers: deployHeaders(),
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    logDeployError('Deploy status', err);
    if (isConnectionRefused(err)) return deployUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to get deploy status' },
      { status: 500 }
    );
  }
}
