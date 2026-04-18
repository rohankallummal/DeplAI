export const DEPLOY_URL = process.env.DEPLOY_URL || 'http://localhost:8001';

export function deployHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  const apiKey = process.env.DEPLAI_SERVICE_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}
