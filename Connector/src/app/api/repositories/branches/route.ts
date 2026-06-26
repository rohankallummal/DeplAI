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
        { error: 'GitHub App installation is suspended.', suspended: true },
        { status: 403 }
      );
    }

    const { defaultBranch, branches } = await githubService.getBranchInfo(
      ownership.installationId,
      owner,
      repo
    );

    return NextResponse.json({ defaultBranch, branches });
  } catch (error) {
    console.error('Error fetching branches:', error);
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to fetch branches') },
      { status: 500 }
    );
  }
}
