export const SECURITY_URL = process.env.SECURITY_URL || 'http://localhost:8000';
export const SECURITY_API_KEY = process.env.DEPLAI_SERVICE_KEY;

export function securityHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  if (SECURITY_API_KEY) {
    headers['X-API-Key'] = SECURITY_API_KEY;
  }
  return headers;
}
