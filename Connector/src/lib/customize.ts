export const CUSTOMIZE_URL = process.env.CUSTOMIZE_URL || 'http://localhost:8002';

export function customizeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  const apiKey = process.env.DEPLAI_SERVICE_KEY;
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return headers;
}
