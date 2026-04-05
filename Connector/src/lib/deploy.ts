export const DEPLOY_URL = process.env.DEPLOY_URL || 'http://localhost:8001';
export const DEPLOY_API_KEY = process.env.DEPLAI_SERVICE_KEY;

export function deployHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  if (DEPLOY_API_KEY) {
    headers['X-API-Key'] = DEPLOY_API_KEY;
  }
  return headers;
}
