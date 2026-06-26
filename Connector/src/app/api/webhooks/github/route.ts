import { NextRequest, NextResponse } from 'next/server';
import { query, type Row } from '@/lib/db';
import { verifyWebhookSignature } from '@/lib/crypto';
import { v4 as uuidv4 } from 'uuid';

interface WebhookInstallation {
  id: number;
  account: { login: string; type: string };
}
interface WebhookRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch?: string;
}
interface InstallationPayload {
  action: string;
  installation: WebhookInstallation;
  repositories?: WebhookRepo[];
}
interface InstallationRepositoriesPayload {
  action: string;
  installation: { id: number };
  repositories_added: WebhookRepo[];
  repositories_removed: WebhookRepo[];
}
interface PushPayload {
  repository: { id: number; full_name: string };
  ref: string;
}
interface PullRequestPayload {
  action: string;
  pull_request: { number: number };
  repository: { id: number; full_name: string };
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    
    if (!signature || !event) {
      return NextResponse.json(
        { error: 'Missing headers' },
        { status: 400 }
      );
    }

    const body = await request.text();
    
    const isValid = verifyWebhookSignature(
      body,
      signature,
      process.env.GITHUB_WEBHOOK_SECRET!
    );

    if (!isValid) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    const payload = JSON.parse(body);

    switch (event) {
      case 'installation':
        await handleInstallation(payload);
        break;
      
      case 'installation_repositories':
        await handleInstallationRepositories(payload);
        break;
      
      case 'push':
        await handlePush(payload);
        break;
      
      case 'pull_request':
        await handlePullRequest(payload);
        break;
      
      default:
        console.log(`Unhandled event: ${event}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleInstallation(payload: InstallationPayload) {
  const { action, installation, repositories } = payload;

  if (action === 'created') {
    const installationId = uuidv4();

    await query(
      `INSERT INTO github_installations 
       (id, installation_id, account_login, account_type, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [
        installationId,
        installation.id,
        installation.account.login,
        installation.account.type,
        JSON.stringify({ installation }),
      ]
    );

    if (repositories) {
      for (const repo of repositories) {
        await storeRepository(installationId, repo);
      }
    }
  } else if (action === 'suspend') {
    await query(
      `UPDATE github_installations SET suspended_at = NOW() WHERE installation_id = ?`,
      [installation.id]
    );
    console.log(`Installation ${installation.id} suspended`);

  } else if (action === 'unsuspend') {
    await query(
      `UPDATE github_installations SET suspended_at = NULL WHERE installation_id = ?`,
      [installation.id]
    );
    console.log(`Installation ${installation.id} unsuspended`);

  } else if (action === 'deleted') {
    const [inst] = await query<Row[]>(
      'SELECT id FROM github_installations WHERE installation_id = ?',
      [installation.id]
    );

    if (inst) {
      await query(
        'DELETE FROM github_repositories WHERE installation_id = ?',
        [inst.id]
      );
    }

    await query(
      'DELETE FROM github_installations WHERE installation_id = ?',
      [installation.id]
    );
  }
}

async function handleInstallationRepositories(payload: InstallationRepositoriesPayload) {
  const { action, installation, repositories_added, repositories_removed } = payload;

  const [inst] = await query<Row[]>(
    'SELECT id FROM github_installations WHERE installation_id = ?',
    [installation.id]
  );

  if (!inst) return;

  if (action === 'added') {
    for (const repo of repositories_added) {
      await storeRepository(inst.id, repo);
    }
  } else if (action === 'removed') {
    for (const repo of repositories_removed) {
      await query(
        'DELETE FROM github_repositories WHERE installation_id = ? AND github_repo_id = ?',
        [inst.id, repo.id]
      );
    }
  }
}

async function handlePush(payload: PushPayload) {
  const { repository, ref } = payload;

  await query(
    `UPDATE github_repositories
     SET needs_refresh = true, last_push_at = NOW()
     WHERE github_repo_id = ?`,
    [repository.id]
  );

  console.log(`Push to ${ref} in ${repository.full_name}, marked as stale`);
}

async function handlePullRequest(payload: PullRequestPayload) {
  const { action, pull_request, repository } = payload;

  if (action !== 'opened' && action !== 'synchronize') {
    return;
  }

  await query(
    `UPDATE github_repositories
     SET needs_refresh = true
     WHERE github_repo_id = ?`,
    [repository.id]
  );

  console.log(`PR #${pull_request.number} in ${repository.full_name} marked as stale`);
}

async function storeRepository(installationId: string, repo: WebhookRepo) {
  await query(
    `INSERT INTO github_repositories 
     (id, installation_id, github_repo_id, full_name, is_private, default_branch)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE 
     full_name = VALUES(full_name),
     default_branch = VALUES(default_branch)`,
    [
      uuidv4(),
      installationId,
      repo.id,
      repo.full_name,
      repo.private,
      repo.default_branch || 'main'
    ]
  );
}