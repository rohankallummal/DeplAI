import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { CUSTOMIZE_URL, customizeHeaders, logCustomizeError } from '@/lib/customize';

export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const response = await fetch(`${CUSTOMIZE_URL}/health`, {
      headers: customizeHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }

    return NextResponse.json({ status: 'healthy' });
  } catch (err) {
    logCustomizeError('Customize health', err);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
