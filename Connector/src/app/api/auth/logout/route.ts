import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import { SECURITY_URL, securityHeaders } from '@/lib/security';
import fs from 'fs';
import path from 'path';

export async function POST() {
  const cookieStore = await cookies();
  const session = await getIronSession(cookieStore, sessionOptions);

  try {
    const cleanupRes = await fetch(`${SECURITY_URL}/api/cleanup`, {
      method: 'POST',
      headers: securityHeaders(),
    });
    if (!cleanupRes.ok) {
      const detail = await cleanupRes.json().catch(() => ({}));
      console.error('Backend cleanup failed:', cleanupRes.status, detail);
    }
  } catch (err) {
    console.error('Backend cleanup unreachable:', err);
  }

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