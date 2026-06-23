import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { CUSTOMIZE_URL, customizeHeaders, logCustomizeError, isConnectionRefused, customizeUnavailableResponse } from '@/lib/customize';

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { project_id } = await request.json();

    const response = await fetch(`${CUSTOMIZE_URL}/api/preview/stop/${project_id}`, {
      method: 'POST',
      headers: customizeHeaders(),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logCustomizeError('Preview stop', error);
    if (isConnectionRefused(error)) return customizeUnavailableResponse();
    return NextResponse.json(
      { success: false, message: 'Preview stop service unreachable' },
      { status: 502 },
    );
  }
}
