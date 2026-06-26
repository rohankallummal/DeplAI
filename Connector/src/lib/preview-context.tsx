'use client';

import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import { fetchWsToken } from './ws-token';

const WS_BASE_URL = process.env.NEXT_PUBLIC_CUSTOMIZE_WS_URL || 'ws://localhost:8002';

export type PreviewPhase = 'idle' | 'preparing' | 'installing' | 'starting' | 'ready' | 'error';

export interface PreviewState {
  phase: PreviewPhase;
  url: string | null;
  error: string | null;
}

interface PreviewContextValue {
  getPreviewState: (projectId: string) => PreviewState;
  startPreview: (projectId: string) => Promise<void>;
  stopPreview: (projectId: string) => Promise<void>;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function usePreview() {
  const context = useContext(PreviewContext);
  if (!context) {
    throw new Error('usePreview must be used within a PreviewProvider');
  }
  return context;
}

const DEFAULT_STATE: PreviewState = {
  phase: 'idle',
  url: null,
  error: null,
};

function getOrDefault(states: Record<string, PreviewState>, pid: string): PreviewState {
  return states[pid] ?? { ...DEFAULT_STATE };
}

// Null every handler before closing so an intentional close never triggers the
// post-open error/close handlers (which would clobber state or delete a newer
// socket's ref entry).
function detachAndClose(ws: WebSocket | undefined) {
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  try { ws.close(); } catch { /* already closing */ }
}

const VALID_PHASES: PreviewPhase[] = ['preparing', 'installing', 'starting', 'ready', 'error'];

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<Record<string, PreviewState>>({});
  const wsRefs = useRef<Record<string, WebSocket>>({});

  const getPreviewState = useCallback((projectId: string): PreviewState => {
    return getOrDefault(states, projectId);
  }, [states]);

  function updateProject(projectId: string, patch: (s: PreviewState) => Partial<PreviewState>) {
    setStates(prev => {
      const existing = getOrDefault(prev, projectId);
      return { ...prev, [projectId]: { ...existing, ...patch(existing) } };
    });
  }

  // Surface an error on an unexpected drop so the panel can't spin forever (an
  // intentional close — handlers nulled first — or a post-ready drop is ignored;
  // a ready preview keeps serving its iframe through the gateway). When the drop
  // is because the backend went away, the BackendMonitor keeps the preview watch
  // active through this 'error' state and overlays the Services Unavailable modal;
  // a drop with a healthy backend just leaves this error screen + Try Again.
  function failIfPending(projectId: string, message: string) {
    updateProject(projectId, existing =>
      existing.phase === 'ready' || existing.phase === 'error'
        ? {}
        : { phase: 'error', error: message }
    );
  }

  function createWsMessageHandler(projectId: string) {
    return (event: MessageEvent) => {
      let data: { type?: string; status?: string; data?: { url?: string } | string };
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // ignore non-JSON frames rather than throwing inside the handler
      }

      switch (data.type) {
        case 'status': {
          const status = (data.status ?? '') as PreviewPhase;
          const phase = VALID_PHASES.includes(status) ? status : 'error';
          updateProject(projectId, () => ({ phase }));
          break;
        }
        case 'ready': {
          const d = data.data;
          // `typeof null === 'object'`, so guard against a null frame before
          // reading `.url` (avoids a TypeError that would strand the spinner).
          const url = d && typeof d === 'object' ? (d.url ?? null) : null;
          updateProject(projectId, () => ({ phase: 'ready', url, error: null }));
          break;
        }
        case 'error': {
          const msg = typeof data.data === 'string' ? data.data : 'Preview failed to start';
          updateProject(projectId, () => ({ phase: 'error', error: msg }));
          break;
        }
      }
    };
  }

  async function connectWs(projectId: string): Promise<WebSocket> {
    const wsToken = await fetchWsToken('preview');
    const base = `${WS_BASE_URL}/ws/preview/${projectId}`;

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base);

      ws.onmessage = createWsMessageHandler(projectId);
      ws.onopen = () => {
        ws.send(JSON.stringify({ action: 'start' }));
        wsRefs.current[projectId] = ws;
        // Once open, surface an unexpected drop as an error so the panel can't
        // spin forever. The BackendMonitor keeps the preview watch active through
        // 'error' and overlays the Services Unavailable modal when the drop is
        // because the backend went away. Only delete the ref if it still points
        // at this socket.
        ws.onerror = () => failIfPending(projectId, 'Lost connection to the preview service.');
        ws.onclose = () => {
          if (wsRefs.current[projectId] === ws) delete wsRefs.current[projectId];
          failIfPending(projectId, 'The preview connection closed unexpectedly.');
        };
        resolve(ws);
      };
      // Pre-open failure → reject so startPreview's catch surfaces it.
      ws.onerror = () => reject(new Error('connection_failed'));
      ws.onclose = () => reject(new Error('connection_closed'));
    });
  }

  const startPreview = useCallback(async (projectId: string) => {
    detachAndClose(wsRefs.current[projectId]);
    delete wsRefs.current[projectId];
    setStates(prev => ({ ...prev, [projectId]: { ...DEFAULT_STATE, phase: 'preparing' } }));
    try {
      await connectWs(projectId);
    } catch {
      // Backend unreachable at start. Surface an error (so the panel doesn't hang
      // on the loading state); the BackendMonitor overlays the Services
      // Unavailable modal once its health check confirms the outage.
      updateProject(projectId, () => ({ phase: 'error', error: 'Preview service is not available.' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connectWs is stable; this starter callback is created once
  }, []);

  const stopPreview = useCallback(async (projectId: string) => {
    // Close the socket WITHOUT sending a teardown command. The backend's
    // disconnect handler only detaches the runner (it does not remove
    // containers), leaving the HTTP endpoint below as the single authoritative
    // teardown path. Triggering both used to race two concurrent force-removes
    // of the same containers, which Docker logged as 409 "removal already in
    // progress".
    detachAndClose(wsRefs.current[projectId]);
    delete wsRefs.current[projectId];
    setStates(prev => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    try {
      await fetch('/api/preview/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
    } catch {
      // best-effort teardown; full cleanup also runs on logout
    }
  }, []);

  const value = useMemo<PreviewContextValue>(() => ({
    getPreviewState,
    startPreview,
    stopPreview,
  }), [getPreviewState, startPreview, stopPreview]);

  return (
    <PreviewContext.Provider value={value}>
      {children}
    </PreviewContext.Provider>
  );
}
