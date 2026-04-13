import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { CUSTOMIZE_URL, customizeHeaders } from '@/lib/customize';

export async function POST() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const response = await fetch(`${CUSTOMIZE_URL}/api/cleanup`, {
      method: 'POST',
      headers: customizeHeaders(),
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      return NextResponse.json(detail, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ success: false, message: 'Cleanup service unreachable' }, { status: 502 });
  }
}
