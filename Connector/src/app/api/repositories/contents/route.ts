import { NextRequest, NextResponse } from 'next/server';
import { githubService } from '@/lib/github';
import { requireAuth, verifyRepositoryOwnership } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const path = searchParams.get('path') || '';

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'owner and repo required' },
        { status: 400 }
      );
    }

    const ownership = await verifyRepositoryOwnership(user.id, owner, repo);

    if (!ownership) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    if (ownership.suspended) {
      return NextResponse.json(
        { error: 'GitHub App installation is suspended. Unsuspend it from your GitHub settings to restore access.', suspended: true },
        { status: 403 }
      );
    }

    const contents = await githubService.getDirectoryContents(
      ownership.installationId,
      owner,
      repo,
      path
    );

    return NextResponse.json({ contents });
  } catch (error: any) {
    console.error('Error fetching contents:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contents' },
      { status: 500 }
    );
  }
}