export const SECURITY_URL = process.env.SECURITY_URL || 'http://localhost:8000';

export function securityHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  const apiKey = process.env.DEPLAI_SERVICE_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}
