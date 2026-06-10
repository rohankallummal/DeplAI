import { withServiceKey, logBackendError, backendUnavailableResponse, isConnectionRefused, isBackendAlive } from './backend';

export const DEPLOY_URL = process.env.DEPLOY_URL || 'http://localhost:8001';
export const deployHeaders = withServiceKey;

export { isConnectionRefused };

export function logDeployError(label: string, error: unknown): void {
  logBackendError(label, DEPLOY_URL, error);
}

export function deployUnavailableResponse() {
  return backendUnavailableResponse('Deploy');
}

export const isDeployBackendAlive = (timeoutMs?: number) =>
  isBackendAlive(DEPLOY_URL, deployHeaders(), timeoutMs);
