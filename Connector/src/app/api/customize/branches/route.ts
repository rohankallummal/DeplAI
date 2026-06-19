import { NextRequest, NextResponse } from 'next/server';
import { githubService } from '@/lib/github';
import { requireAuth, verifyRepositoryOwnership } from '@/lib/auth';
import { query } from '@/lib/db';

// Backs the branch-aware customization popup in one GitHub round trip: the
// customizable base branches (Step 1) plus this project's open DeplAI
// customization PRs across all bases (Step 2 filters them by the chosen base
// client-side, so no second PR fetch is needed).
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const projectId = searchParams.get('project_id');

    if (!owner || !repo || !projectId) {
      return NextResponse.json({ error: 'owner, repo and project_id required' }, { status: 400 });
    }

    const ownership = await verifyRepositoryOwnership(user.id, owner, repo);
    if (!ownership) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }
    if (ownership.suspended) {
      return NextResponse.json(
        { error: 'GitHub App installation is suspended.', suspended: true },
        { status: 403 },
      );
    }

    // Bind the client-supplied project_id to this repo: for GitHub projects
    // project_id is the github_repositories row id, which must map to owner/repo.
    const [row] = await query<any[]>(
      'SELECT 1 AS ok FROM github_repositories WHERE id = ? AND full_name = ?',
      [projectId, `${owner}/${repo}`],
    );
    if (!row) {
      return NextResponse.json({ error: 'project_id does not match repository' }, { status: 400 });
    }

    const { defaultBranch, branches, pulls } = await githubService.getCustomizeOptions(
      ownership.installationId,
      owner,
      repo,
      projectId,
    );

    return NextResponse.json({ defaultBranch, branches, pulls });
  } catch (error: any) {
    console.error('Error fetching customize options:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch branches' },
      { status: 500 },
    );
  }
}
