import { withServiceKey, logBackendError, backendUnavailableResponse, isConnectionRefused, isBackendAlive } from './backend';

export const CUSTOMIZE_URL = process.env.CUSTOMIZE_URL || 'http://localhost:8002';
export const customizeHeaders = withServiceKey;

export { isConnectionRefused };

export function logCustomizeError(label: string, error: unknown): void {
  logBackendError(label, CUSTOMIZE_URL, error);
}

export function customizeUnavailableResponse() {
  return backendUnavailableResponse('Customize');
}

export const isCustomizeBackendAlive = (timeoutMs?: number) =>
  isBackendAlive(CUSTOMIZE_URL, customizeHeaders(), timeoutMs);
