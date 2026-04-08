export const CUSTOMIZE_URL = process.env.CUSTOMIZE_URL || 'http://localhost:8002';
export const CUSTOMIZE_API_KEY = process.env.DEPLAI_SERVICE_KEY;

export function customizeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  if (CUSTOMIZE_API_KEY) {
    headers['X-API-Key'] = CUSTOMIZE_API_KEY;
  }
  return headers;
}
