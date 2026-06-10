import { withServiceKey, logBackendError, backendUnavailableResponse, isConnectionRefused, isBackendAlive } from './backend';

export const SECURITY_URL = process.env.SECURITY_URL || 'http://localhost:8000';
export const securityHeaders = withServiceKey;

export { isConnectionRefused };

export function logSecurityError(label: string, error: unknown): void {
  logBackendError(label, SECURITY_URL, error);
}

export function securityUnavailableResponse() {
  return backendUnavailableResponse('Security');
}

export const isSecurityBackendAlive = (timeoutMs?: number) =>
  isBackendAlive(SECURITY_URL, securityHeaders(), timeoutMs);
