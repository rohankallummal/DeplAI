import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions, SessionData } from '@/lib/session';
import { SECURITY_URL, securityHeaders } from '@/lib/security';

function popupResponse(success: boolean, error?: string) {
  const payload = JSON.stringify({ type: 'publish-auth', success, error: error ?? null });
  return new NextResponse(
    `<!DOCTYPE html>
<html><head><title>Authorizing…</title></head>
<body><script>
  window.opener?.postMessage(${payload}, window.location.origin);
  window.close();
</script><p>You can close this window.</p></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.isLoggedIn || !session.user) {
    return popupResponse(false, 'Not authenticated');
  }

  if (!code || !state || state !== session.publishState) {
    return popupResponse(false, 'Invalid OAuth state');
  }

  delete session.publishState;
  await session.save();

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return popupResponse(false, 'GitHub authorization failed');
  }

  try {
    await fetch(`${SECURITY_URL}/api/publish/token`, {
      method: 'POST',
      headers: securityHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        user_id: session.user.id,
        token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? null,
        expires_in: tokenData.expires_in ?? null,
      }),
    });
  } catch {
    return popupResponse(false, 'Failed to store token');
  }

  return popupResponse(true);
}
