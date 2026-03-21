import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { githubService } from '@/lib/github';

export async function POST() {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { removed, added } = await githubService.syncInstallations(user.id);

    return NextResponse.json({ success: true, removed, added });
  } catch (error: any) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: error.message || 'Sync failed' },
      { status: 500 }
    );
  }
}
