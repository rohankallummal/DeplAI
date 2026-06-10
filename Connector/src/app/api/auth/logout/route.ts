import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import { SECURITY_URL, securityHeaders, isSecurityBackendAlive } from '@/lib/security';
import { CUSTOMIZE_URL, customizeHeaders, isCustomizeBackendAlive } from '@/lib/customize';
import { DEPLOY_URL, deployHeaders, isDeployBackendAlive } from '@/lib/deploy';
import { logBackendError } from '@/lib/backend';
import fs from 'fs';
import path from 'path';

async function cleanupBackend(
  name: string,
  url: string,
  headers: Record<string, string>,
  alive: boolean,
) {
  if (!alive) {
    console.info(`${name} backend not reachable — skipping cleanup.`);
    return;
  }
  try {
    const res = await fetch(`${url}/api/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      console.error(`${name} cleanup failed:`, res.status, detail);
    }
  } catch (err) {
    logBackendError(`${name} cleanup`, url, err);
  }
}

export async function POST() {
  const cookieStore = await cookies();
  const session = await getIronSession(cookieStore, sessionOptions);

  const [securityAlive, customizeAlive, deployAlive] = await Promise.all([
    isSecurityBackendAlive(),
    isCustomizeBackendAlive(),
    isDeployBackendAlive(),
  ]);

  await Promise.all([
    cleanupBackend('Security', SECURITY_URL, securityHeaders(), securityAlive),
    cleanupBackend('Customize', CUSTOMIZE_URL, customizeHeaders(), customizeAlive),
    cleanupBackend('Deploy', DEPLOY_URL, deployHeaders(), deployAlive),
  ]);

  try {
    const reposDir = path.join(process.cwd(), 'tmp', 'repos');
    if (fs.existsSync(reposDir)) {
      fs.rmSync(reposDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Failed to clear cloned repos:', err);
  }

  session.destroy();

  return NextResponse.json({ success: true });
}