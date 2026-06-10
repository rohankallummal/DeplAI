import { NextRequest, NextResponse } from 'next/server';
import { Agent } from 'undici';
import { requireAuth, verifyAnyProjectAccess } from '@/lib/auth';
import { DEPLOY_URL, deployHeaders, logDeployError, isConnectionRefused, deployUnavailableResponse } from '@/lib/deploy';

export const maxDuration = 1800;

const destroyDispatcher = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
  connectTimeout: 30_000,
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
    }

    const ownership = await verifyAnyProjectAccess(user.id, project_id);
    if (ownership.error) return ownership.error;

    const response = await fetch(`${DEPLOY_URL}/api/deploy/destroy`, {
      method: 'POST',
      headers: deployHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ project_id }),
      // @ts-expect-error - undici dispatcher, supported at runtime in Node fetch
      dispatcher: destroyDispatcher,
    });

    if (!response.ok) {
      throw new Error('Backend request failed');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    logDeployError('Deploy destroy', err);
    if (isConnectionRefused(err)) return deployUnavailableResponse();
    return NextResponse.json(
      { error: 'Failed to destroy deployment' },
      { status: 500 }
    );
  }
}
