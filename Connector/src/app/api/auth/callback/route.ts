import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { sessionOptions, SessionData } from '@/lib/session';
import { query } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

function fetchGitHub(endpoint: string, accessToken: string) {
  return fetch(`https://api.github.com${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=no_code`);
    }

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=token_error`);
    }

    const accessToken = tokenData.access_token;

    const [githubUser, emails] = await Promise.all([
      fetchGitHub('/user', accessToken).then(r => r.json()),
      fetchGitHub('/user/emails', accessToken).then(r => r.json()),
    ]);

    const primaryEmail = emails.find((e: any) => e.primary)?.email || emails[0]?.email;

    let [user] = await query<any[]>(
      'SELECT id FROM users WHERE email = ?',
      [primaryEmail]
    );

    if (!user) {
      const userId = uuidv4();
      await query(
        `INSERT INTO users (id, email, name) VALUES (?, ?, ?)`,
        [userId, primaryEmail, githubUser.name || githubUser.login]
      );
      user = { id: userId };
    }

    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
    session.user = {
      id: user.id,
      githubId: githubUser.id,
      login: githubUser.login,
      email: primaryEmail,
      name: githubUser.name || githubUser.login,
      avatarUrl: githubUser.avatar_url,
    };
    session.isLoggedIn = true;
    await session.save();

    await query(
      `UPDATE github_installations
       SET user_id = ?
       WHERE account_login = ? AND user_id IS NULL`,
      [user.id, githubUser.login]
    );

    const orgsResponse = await fetchGitHub('/user/orgs', accessToken);

    if (orgsResponse.ok) {
      const orgs = await orgsResponse.json();
      for (const org of orgs) {
        await query(
          `UPDATE github_installations
           SET user_id = ?
           WHERE account_login = ? AND account_type = 'Organization' AND user_id IS NULL`,
          [user.id, org.login]
        );
      }
    }

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard`);
  } catch (error) {
    console.error('Auth callback error:', error);
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/?error=auth_failed`);
  }
}
