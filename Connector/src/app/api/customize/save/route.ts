import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { CUSTOMIZE_URL, customizeHeaders } from '@/lib/customize';

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { project_id } = await request.json();

    const response = await fetch(`${CUSTOMIZE_URL}/api/customize/save/${project_id}`, {
      method: 'POST',
      headers: customizeHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { success: false, message: 'Save service unreachable' },
      { status: 502 },
    );
  }
}
