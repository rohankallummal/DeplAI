import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { DEPLOY_URL, deployHeaders } from '@/lib/deploy';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    const response = await fetch(`${DEPLOY_URL}/api/deploy/cost-pdf/${projectId}`, {
      headers: deployHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: text || 'Failed to generate cost PDF' },
        { status: response.status }
      );
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="cost-breakdown.pdf"',
      },
    });
  } catch (err) {
    console.error('Cost PDF proxy error:', err);
    return NextResponse.json({ error: 'Failed to get cost PDF' }, { status: 500 });
  }
}
