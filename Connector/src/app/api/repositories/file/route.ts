import { NextRequest, NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/backend';
import { githubService } from '@/lib/github';
import { requireAuth, verifyRepositoryOwnership } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const filePath = searchParams.get('path');
    const branch = searchParams.get('branch') || undefined;

    if (!owner || !repo || !filePath) {
      return NextResponse.json(
        { error: 'owner, repo, and path required' },
        { status: 400 }
      );
    }

    const repoAccess = await verifyRepositoryOwnership(user.id, owner, repo);
    if (!repoAccess) {
      return NextResponse.json(
        { error: 'Forbidden: You do not own this repository' },
        { status: 403 }
      );
    }

    const content = await githubService.getFileContents(
      repoAccess.installationId,
      owner,
      repo,
      filePath,
      branch
    );

    return NextResponse.json({ content, path: filePath });
  } catch (error) {
    console.error('Error fetching file:', error);
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to fetch file') },
      { status: 500 }
    );
  }
}