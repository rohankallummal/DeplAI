import { NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions } from '@/lib/session';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

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

  session.destroy();

  return NextResponse.json({ success: true });
}