import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { query } from './db';
import { v4 as uuidv4 } from 'uuid';
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';

interface GitHubConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

interface CachedToken {
  token: string;
  expiresAt: Date;
}

export class GitHubService {
  private config: GitHubConfig;
  private app: Octokit;
  private tokenCache = new Map<string, CachedToken>();

  constructor(config: GitHubConfig) {
    this.config = config;

    this.app = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.appId,
        privateKey: config.privateKey.replace(/\\n/g, '\n'),
      },
    });
  }

  async getInstallationToken(installationId: string): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt > new Date()) {
      return cached.token;
    }

    const installations = await query<any[]>(
      'SELECT installation_id FROM github_installations WHERE id = ?',
      [installationId]
    );

    if (!installations?.length) {
      throw new Error('Installation not found');
    }

    let data;
    try {
      ({ data } = await this.app.apps.createInstallationAccessToken({
        installation_id: installations[0].installation_id,
      }));
    } catch (err: any) {
      if (err.status === 403) {
        await query(
          `UPDATE github_installations SET suspended_at = NOW() WHERE id = ?`,
          [installationId]
        );
        throw new Error('GitHub App installation is suspended. Please unsuspend it from your GitHub settings.');
      }
      throw err;
    }

    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    });

    return data.token;
  }

  async getInstallationClient(installationId: string): Promise<Octokit> {
    const token = await this.getInstallationToken(installationId);
    return new Octokit({ auth: token });
  }

  async getRepository(installationId: string, owner: string, repo: string) {
    const octokit = await this.getInstallationClient(installationId);
    const { data } = await octokit.repos.get({ owner, repo });
    
    const { data: languages } = await octokit.repos.listLanguages({ 
      owner, 
      repo 
    });

    return {
      id: data.id,
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      languages,
      size: data.size,
      pushedAt: data.pushed_at,
    };
  }

  async createWebhook(
    installationId: string,
    owner: string,
    repo: string,
    webhookUrl: string
  ): Promise<number> {
    const octokit = await this.getInstallationClient(installationId);
    
    const { data } = await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret: this.config.webhookSecret,
        insecure_ssl: '0',
      },
      events: ['push', 'pull_request'],
      active: true,
    });

    return data.id;
  }

  private repoBasePath(owner: string, repo: string): string {
    return path.join(process.cwd(), 'tmp', 'repos', owner, repo);
  }

  private branchPath(owner: string, repo: string, branch: string): string {
    return path.join(this.repoBasePath(owner, repo), branch);
  }

  private authUrl(token: string, owner: string, repo: string): string {
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  private parseDefaultBranch(symrefOutput: string): string {
    const match = symrefOutput.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
    return match ? match[1] : 'main';
  }

  private async updateDefaultBranch(owner: string, repo: string, branch: string): Promise<void> {
    await query(
      `UPDATE github_repositories SET default_branch = ? WHERE full_name = ?`,
      [branch, `${owner}/${repo}`]
    );
  }

  async getRemoteDefaultBranch(installationId: string, owner: string, repo: string): Promise<string> {
    const token = await this.getInstallationToken(installationId);
    const output = await simpleGit().listRemote(['--symref', this.authUrl(token, owner, repo), 'HEAD']);
    const defaultBranch = this.parseDefaultBranch(output);
    await this.updateDefaultBranch(owner, repo, defaultBranch);
    return defaultBranch;
  }

  async getBranchInfo(installationId: string, owner: string, repo: string): Promise<{ defaultBranch: string; branches: string[] }> {
    const token = await this.getInstallationToken(installationId);
    const url = this.authUrl(token, owner, repo);

    const [symrefOutput, headsOutput] = await Promise.all([
      simpleGit().listRemote(['--symref', url, 'HEAD']),
      simpleGit().listRemote(['--heads', url]),
    ]);

    const defaultBranch = this.parseDefaultBranch(symrefOutput);

    const branches = headsOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split('\t')[1]?.replace('refs/heads/', '') || '')
      .filter(Boolean);

    await this.updateDefaultBranch(owner, repo, defaultBranch);
    return { defaultBranch, branches };
  }

  private async getEffectiveBranch(installationId: string, owner: string, repo: string): Promise<string> {
    const [repoData] = await query<any[]>(
      `SELECT default_branch FROM github_repositories WHERE full_name = ?`,
      [`${owner}/${repo}`]
    );

    if (repoData?.default_branch) return repoData.default_branch;

    return await this.getRemoteDefaultBranch(installationId, owner, repo);
  }

  async cloneBranch(
    installationId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<string> {
    const token = await this.getInstallationToken(installationId);
    const branchDir = this.branchPath(owner, repo, branch);

    if (fs.existsSync(branchDir)) {
      fs.rmSync(branchDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(branchDir), { recursive: true });

    const cloneUrl = this.authUrl(token, owner, repo);
    const git = simpleGit();

    console.log(`Cloning ${owner}/${repo} (branch: ${branch})...`);
    await git.clone(cloneUrl, branchDir, ['--depth', '1', '--single-branch', '--branch', branch]);
    console.log(`Cloned ${owner}/${repo} (branch: ${branch}) successfully`);

    return branchDir;
  }

  async pullBranch(
    installationId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<string> {
    const branchDir = this.branchPath(owner, repo, branch);

    if (!fs.existsSync(branchDir)) {
      throw new Error('Branch not cloned yet');
    }

    const token = await this.getInstallationToken(installationId);
    const git = simpleGit(branchDir);
    await git.remote(['set-url', 'origin', this.authUrl(token, owner, repo)]);

    console.log(`Pulling latest for ${owner}/${repo} (branch: ${branch})...`);
    await git.pull('origin', branch);
    console.log(`Updated ${owner}/${repo} (branch: ${branch}) successfully`);

    return branchDir;
  }

  async ensureBranchFresh(
    installationId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<string> {
    const branchDir = this.branchPath(owner, repo, branch);

    const [repoData] = await query<any[]>(
      `SELECT needs_refresh FROM github_repositories WHERE full_name = ?`,
      [`${owner}/${repo}`]
    );

    if (!repoData) {
      throw new Error('Repository not found in database');
    }

    const needsClone = !fs.existsSync(branchDir);

    if (!needsClone && !repoData.needs_refresh) {
      return branchDir;
    }

    const result = needsClone
      ? await this.cloneBranch(installationId, owner, repo, branch)
      : await this.pullBranch(installationId, owner, repo, branch);

    if (repoData.needs_refresh) {
      await query(
        `UPDATE github_repositories SET needs_refresh = false WHERE full_name = ?`,
        [`${owner}/${repo}`]
      );
    }

    return result;
  }

  async getDirectoryContents(
    installationId: string,
    owner: string,
    repo: string,
    dirPath: string = '',
    branch?: string
  ): Promise<any[]> {
    const effectiveBranch = branch || await this.getEffectiveBranch(installationId, owner, repo);
    const repoPath = await this.ensureBranchFresh(installationId, owner, repo, effectiveBranch);
    const fullPath = path.join(repoPath, dirPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error('Path does not exist');
    }

    const items = fs.readdirSync(fullPath, { withFileTypes: true });

    return items
      .filter(item => !item.name.startsWith('.'))
      .map(item => ({
        name: item.name,
        path: path.join(dirPath, item.name).replace(/\\/g, '/'),
        type: item.isDirectory() ? 'dir' : 'file',
        size: item.isFile() ? fs.statSync(path.join(fullPath, item.name)).size : null,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'dir' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  async getFileContents(
    installationId: string,
    owner: string,
    repo: string,
    filePath: string,
    branch?: string
  ): Promise<string> {
    const effectiveBranch = branch || await this.getEffectiveBranch(installationId, owner, repo);
    const repoPath = await this.ensureBranchFresh(installationId, owner, repo, effectiveBranch);
    const fullPath = path.join(repoPath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error('File does not exist');
    }

    if (fs.statSync(fullPath).isDirectory()) {
      throw new Error('Path is a directory, not a file');
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  async forceRefresh(installationId: string, owner: string, repo: string, branch?: string): Promise<void> {
    const effectiveBranch = branch || await this.getEffectiveBranch(installationId, owner, repo);
    fs.rmSync(this.branchPath(owner, repo, effectiveBranch), { recursive: true, force: true });
    await this.cloneBranch(installationId, owner, repo, effectiveBranch);
  }

  async syncInstallations(userId: string): Promise<{ removed: number; added: number }> {
    const installations = await query<any[]>(
      `SELECT id, installation_id, account_login
       FROM github_installations
       WHERE user_id = ?`,
      [userId]
    );

    let totalRemoved = 0;
    let totalAdded = 0;

    for (const inst of installations) {
      const alive = await this.isInstallationAlive(inst.installation_id);

      if (!alive) {
        const deleted = await query<any>(
          'DELETE FROM github_repositories WHERE installation_id = ?',
          [inst.id]
        );
        totalRemoved += deleted.affectedRows ?? 0;

        await query(
          'DELETE FROM github_installations WHERE id = ?',
          [inst.id]
        );
        this.tokenCache.delete(inst.id);
        console.log(`Sync: removed dead installation ${inst.account_login} (${inst.installation_id})`);
        continue;
      }

      const result = await this.syncReposForInstallation(inst.id);
      totalRemoved += result.removed;
      totalAdded += result.added;
    }

    return { removed: totalRemoved, added: totalAdded };
  }

  private async isInstallationAlive(githubInstallationId: number): Promise<boolean> {
    try {
      await this.app.apps.getInstallation({ installation_id: githubInstallationId });
      return true;
    } catch (err: any) {
      if (err.status === 404 || err.status === 403) {
        return false;
      }
      console.error(`Sync: unexpected error checking installation ${githubInstallationId}:`, err.message);
      return true;
    }
  }

  private async syncReposForInstallation(
    internalId: string,
  ): Promise<{ removed: number; added: number }> {
    let token: string;
    try {
      token = await this.getInstallationToken(internalId);
    } catch {
      return { removed: 0, added: 0 };
    }

    const octokit = new Octokit({ auth: token });

    let liveRepos: { id: number; full_name: string; private: boolean; default_branch: string }[];
    try {
      const pages = await octokit.paginate(
        octokit.apps.listReposAccessibleToInstallation,
        { per_page: 100 },
      );
      liveRepos = (pages as any[]).map((r: any) => ({
        id: r.id,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch || 'main',
      }));
    } catch (err: any) {
      console.error(`Sync: failed to list repos for installation ${internalId}:`, err.message);
      return { removed: 0, added: 0 };
    }

    const liveRepoIds = new Set(liveRepos.map(r => r.id));

    const dbRepos = await query<any[]>(
      'SELECT id, github_repo_id FROM github_repositories WHERE installation_id = ?',
      [internalId]
    );
    const dbRepoIds = new Set(dbRepos.map((r: any) => r.github_repo_id));

    let removed = 0;
    for (const dbRepo of dbRepos) {
      if (!liveRepoIds.has(dbRepo.github_repo_id)) {
        await query('DELETE FROM github_repositories WHERE id = ?', [dbRepo.id]);
        removed++;
      }
    }

    let added = 0;
    for (const liveRepo of liveRepos) {
      if (!dbRepoIds.has(liveRepo.id)) {
        await query(
          `INSERT INTO github_repositories
           (id, installation_id, github_repo_id, full_name, is_private, default_branch)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           full_name = VALUES(full_name),
           default_branch = VALUES(default_branch)`,
          [uuidv4(), internalId, liveRepo.id, liveRepo.full_name, liveRepo.private, liveRepo.default_branch]
        );
        added++;
      }
    }

    if (removed > 0 || added > 0) {
      console.log(`Sync: installation ${internalId}: removed ${removed}, added ${added} repos`);
    }

    return { removed, added };
  }

}

export const githubService = new GitHubService({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_PRIVATE_KEY!,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
});