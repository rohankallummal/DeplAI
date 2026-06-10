import { NextResponse } from 'next/server';

export function withServiceKey(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const apiKey = process.env.DEPLAI_SERVICE_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

export function isConnectionRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === 'ECONNREFUSED';
}

export function logBackendError(label: string, url: string, error: unknown): void {
  if (isConnectionRefused(error)) {
    console.error(`[${label}] Backend unreachable at ${url} — ensure the service is running.`);
  } else {
    console.error(`${label}:`, error);
  }
}

export function backendUnavailableResponse(name: string) {
  return NextResponse.json(
    { error: `${name} backend is unavailable. Please ensure the ${name} service is running.` },
    { status: 503 },
  );
}

export async function isBackendAlive(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 1500,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
