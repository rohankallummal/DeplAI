import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { SECURITY_URL, securityHeaders, logSecurityError } from '@/lib/security';

export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const response = await fetch(`${SECURITY_URL}/health`, {
      headers: securityHeaders(),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
    }

    return NextResponse.json({ status: 'healthy' });
  } catch (err) {
    logSecurityError('Security health', err);
    return NextResponse.json({ error: 'Backend unavailable' }, { status: 503 });
  }
}
