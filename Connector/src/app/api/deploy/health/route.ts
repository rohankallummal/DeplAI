import { NextResponse } from 'next/server';
import { DEPLOY_URL, deployHeaders } from '@/lib/deploy';

export async function GET() {
  try {
    const response = await fetch(`${DEPLOY_URL}/health`, {
      headers: deployHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }

    return NextResponse.json({ status: 'healthy' });
  } catch (err) {
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
