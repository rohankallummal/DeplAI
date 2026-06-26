import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/backend';
import { requireAuth } from '@/lib/auth';
import { githubService } from '@/lib/github';

export async function POST() {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { removed, added } = await githubService.syncInstallations(user.id);

    return NextResponse.json({ success: true, removed, added });
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: getErrorMessage(error, 'Sync failed') },
      { status: 500 }
    );
  }
}
