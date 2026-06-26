import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { DEPLOY_URL, deployHeaders, logDeployError } from '@/lib/deploy';

export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const response = await fetch(`${DEPLOY_URL}/health`, {
      headers: deployHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }

    return NextResponse.json({ status: 'healthy' });
  } catch (err) {
    logDeployError('Deploy health', err);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
