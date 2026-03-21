import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  const token = process.env.DEPLAI_SERVICE_KEY || '';

  return NextResponse.json({ token });
}
