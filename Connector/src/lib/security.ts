export const SECURITY_URL = process.env.SECURITY_URL || 'http://localhost:8000';

export function securityHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  const apiKey = process.env.DEPLAI_SERVICE_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}

export async function isSecurityBackendAlive(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SECURITY_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: securityHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
