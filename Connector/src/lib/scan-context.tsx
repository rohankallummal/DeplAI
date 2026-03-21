'use client';

import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';

const WS_BASE_URL = process.env.NEXT_PUBLIC_SECURITY_WS_URL || 'ws://localhost:8000';

type OperationState = 'idle' | 'running' | 'completed' | 'error';
export type ScanState = OperationState;
export type RemediationState = OperationState;
export type VulnStatus = 'not_initiated' | 'found' | 'not_found' | 'remediated' | 'not_remediated';

export interface CachedScanResults {
  status: VulnStatus;
  data: { supply_chain: unknown[]; code_security: unknown[] } | null;
}

export interface ScanMessage {
  index: number;
  total: number;
  type: string;
  content: string;
  timestamp: string;
}

interface ProjectScanState {
  state: ScanState;
  messages: ScanMessage[];
  projectName: string;
}

export interface RemediationResult {
  success: boolean;
  message: string;
  cycles_run: number;
}

interface ProjectRemediationState {
  state: RemediationState;
  messages: ScanMessage[];
  result: RemediationResult | null;
}

interface ScanContextValue {
  startScan: (projectId: string, projectName: string) => Promise<void>;
  getScanState: (projectId: string) => ProjectScanState;
  activeScanIds: string[];
  resetAll: () => void;
  startRemediation: (projectId: string) => Promise<void>;
  getRemediationState: (projectId: string) => ProjectRemediationState;
  getRemediationResult: (projectId: string) => RemediationResult | null;
  isAnyRemediating: boolean;
  activeRemediationIds: string[];
  getCachedResults: (projectId: string) => CachedScanResults | null;
  setCachedResults: (projectId: string, results: CachedScanResults) => void;
  restoreState: (projectId: string) => Promise<void>;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function useScan() {
  const context = useContext(ScanContext);
  if (!context) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}

async function fetchWsToken(): Promise<string> {
  try {
    const res = await fetch('/api/scan/ws-token');
    if (!res.ok) return '';
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
  }
}

function connectWebSocket(
  path: string,
  projectId: string,
  onMessage: (projectId: string, msg: ScanMessage) => void,
  onStatus: (projectId: string, status: string) => void,
  onError: (projectId: string) => void,
  onClose: (projectId: string) => void,
  wsToken: string,
  onResult?: (projectId: string, result: RemediationResult) => void,
): WebSocket {
  const base = `${WS_BASE_URL}${path}/${projectId}`;
  const ws = new WebSocket(wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base);

  ws.onopen = () => {
    ws.send(JSON.stringify({ action: 'start' }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'message':
        if (data.data?.type !== 'debug') {
          onMessage(projectId, data.data as ScanMessage);
        }
        break;
      case 'status':
        if (['running', 'completed', 'error'].includes(data.status)) {
          onStatus(projectId, data.status);
        }
        break;
      case 'result':
        if (onResult) onResult(projectId, data.data as RemediationResult);
        break;
    }
  };

  ws.onerror = () => onError(projectId);
  ws.onclose = () => onClose(projectId);

  return ws;
}

function useOperationState<T extends { state: OperationState; messages: ScanMessage[] }>(
  defaultState: () => T,
) {
  const [states, setStates] = useState<Record<string, T>>({});
  const wsRefsInternal = useRef<Record<string, WebSocket>>({});

  const appendMessage = useCallback((projectId: string, message: ScanMessage) => {
    setStates(prev => {
      const existing = prev[projectId];
      if (!existing) return prev;
      return { ...prev, [projectId]: { ...existing, messages: [...existing.messages, message] } as T };
    });
  }, []);

  const updateStatus = useCallback((projectId: string, status: string) => {
    setStates(prev => ({
      ...prev,
      [projectId]: { ...prev[projectId], state: status as OperationState } as T,
    }));
  }, []);

  const getState = useCallback((projectId: string): T => {
    return states[projectId] || defaultState();
  }, [states, defaultState]);

  const activeIds = useMemo(() => {
    return Object.entries(states)
      .filter(([, s]) => s.state === 'running')
      .map(([id]) => id);
  }, [states]);

  return { states, setStates, wsRefs: wsRefsInternal, appendMessage, updateStatus, getState, activeIds };
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const scan = useOperationState<ProjectScanState>(
    useCallback(() => ({ state: 'idle', messages: [], projectName: '' }), []),
  );
  const remediation = useOperationState<ProjectRemediationState>(
    useCallback(() => ({ state: 'idle', messages: [], result: null }), []),
  );

  const setRemediationResult = useCallback((projectId: string, result: RemediationResult) => {
    remediation.setStates(prev => ({
      ...prev,
      [projectId]: { ...prev[projectId], result },
    }));
  }, []);
  const [resultsCache, setResultsCache] = useState<Record<string, CachedScanResults>>({});

  const startScan = useCallback(async (projectId: string, projectName: string) => {
    scan.wsRefs.current[projectId]?.close();

    scan.setStates(prev => ({
      ...prev,
      [projectId]: { state: 'running', messages: [], projectName },
    }));

    setResultsCache(prev => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });

    const wsToken = await fetchWsToken();
    scan.wsRefs.current[projectId] = connectWebSocket(
      '/ws/scan', projectId,
      scan.appendMessage,
      scan.updateStatus,
      (id) => scan.updateStatus(id, 'error'),
      (id) => { delete scan.wsRefs.current[id]; },
      wsToken,
    );
  }, [scan.appendMessage, scan.updateStatus]);

  const startRemediation = useCallback(async (projectId: string) => {
    remediation.wsRefs.current[projectId]?.close();

    remediation.setStates(prev => ({
      ...prev,
      [projectId]: { state: 'running', messages: [], result: null },
    }));

    try {
      const res = await fetch('/api/remediate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        remediation.updateStatus(projectId, 'error');
        return;
      }
    } catch {
      remediation.updateStatus(projectId, 'error');
      return;
    }

    const wsToken = await fetchWsToken();
    remediation.wsRefs.current[projectId] = connectWebSocket(
      '/ws/remediate', projectId,
      remediation.appendMessage,
      remediation.updateStatus,
      (id) => remediation.updateStatus(id, 'error'),
      (id) => { delete remediation.wsRefs.current[id]; },
      wsToken,
      setRemediationResult,
    );
  }, [remediation.appendMessage, remediation.updateStatus, setRemediationResult]);

  const getRemediationResult = useCallback((projectId: string): RemediationResult | null => {
    return remediation.states[projectId]?.result || null;
  }, [remediation.states]);

  const isAnyRemediating = useMemo(() => {
    return Object.values(remediation.states).some(s => s.state === 'running');
  }, [remediation.states]);

  const getCachedResults = useCallback((projectId: string): CachedScanResults | null => {
    return resultsCache[projectId] || null;
  }, [resultsCache]);

  const setCachedResults = useCallback((projectId: string, results: CachedScanResults) => {
    setResultsCache(prev => ({ ...prev, [projectId]: results }));
  }, []);

  const restoreState = useCallback(async (projectId: string) => {
    const currentScan = scan.states[projectId];
    const currentRem = remediation.states[projectId];
    if (currentScan?.state === 'running' || currentRem?.state === 'running') return;

    async function reconnect<T extends { state: OperationState; messages: ScanMessage[] }>(
      op: ReturnType<typeof useOperationState<T>>,
      wsPath: string,
      initialState: T,
      onResult?: (projectId: string, result: RemediationResult) => void,
    ) {
      op.setStates(prev => ({ ...prev, [projectId]: initialState }));
      const wsToken = await fetchWsToken();
      op.wsRefs.current[projectId] = connectWebSocket(
        wsPath, projectId,
        op.appendMessage, op.updateStatus,
        (id) => op.updateStatus(id, 'error'),
        (id) => { delete op.wsRefs.current[id]; },
        wsToken, onResult,
      );
    }

    try {
      const res = await fetch(`/api/operations/status?project_id=${projectId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.scan?.active) {
        await reconnect(scan, '/ws/scan', {
          state: 'running', messages: [], projectName: scan.states[projectId]?.projectName || '',
        } as ProjectScanState);
      } else if (data.remediation?.active) {
        await reconnect(remediation, '/ws/remediate', {
          state: 'running', messages: [], result: null,
        } as ProjectRemediationState, setRemediationResult);
      }
    } catch {
    }
  }, [scan.states, remediation.states, scan.appendMessage, scan.updateStatus, remediation.appendMessage, remediation.updateStatus, setRemediationResult]);

  const resetAll = useCallback(() => {
    Object.values(scan.wsRefs.current).forEach(ws => ws.close());
    Object.values(remediation.wsRefs.current).forEach(ws => ws.close());
    scan.wsRefs.current = {};
    remediation.wsRefs.current = {};
    scan.setStates({});
    remediation.setStates({});
    setResultsCache({});
  }, []);

  const value = useMemo<ScanContextValue>(() => ({
    startScan,
    getScanState: scan.getState,
    activeScanIds: scan.activeIds,
    resetAll,
    startRemediation,
    getRemediationState: remediation.getState,
    getRemediationResult,
    isAnyRemediating,
    activeRemediationIds: remediation.activeIds,
    getCachedResults,
    setCachedResults,
    restoreState,
  }), [startScan, scan.getState, scan.activeIds, resetAll, startRemediation, remediation.getState, getRemediationResult, isAnyRemediating, remediation.activeIds, getCachedResults, setCachedResults, restoreState]);

  return (
    <ScanContext.Provider value={value}>
      {children}
    </ScanContext.Provider>
  );
}
