'use client';

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
} from 'react';
import ServiceUnavailableModal from '@/components/service-unavailable-modal';

export type BackendService = 'security' | 'deploy' | 'customize';

const HEALTH_ROUTES: Record<BackendService, string> = {
  security: '/api/scan/health',
  deploy: '/api/deploy/health',
  customize: '/api/customize/health',
};

const POLL_MS = 3000;
const TIMEOUT_MS = 2000;

interface Watch {
  id: string;
  service: BackendService;
  onRecover: () => void;
}

interface BackendMonitorContextValue {
  register: (id: string, service: BackendService, onRecover: () => void) => void;
  unregister: (id: string) => void;
  requestImmediateCheck: (id: string) => void;
  setDeferred: (id: string, deferred: boolean) => void;
  flushOutage: (id: string) => boolean;
}

const BackendMonitorContext = createContext<BackendMonitorContextValue | null>(null);

// A health check counts as DOWN on any non-ok status, network error, or timeout.
async function checkHealth(service: BackendService): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_ROUTES[service], {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function BackendMonitorProvider({ children }: { children: React.ReactNode }) {
  // The single foreground watch lives in a ref (read by the async poll loop
  // without restarting it); `activeService` mirrors it as state so the polling
  // effect re-subscribes when the watched service changes.
  const watchRef = useRef<Watch | null>(null);
  const [activeService, setActiveService] = useState<BackendService | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const modalOpenRef = useRef(false);
  const onRecoverRef = useRef<(() => void) | null>(null);

  // True while a confirmation popup is open: the poll keeps running but arms an
  // outage silently instead of opening the modal (read via ref so the poll loop
  // doesn't restart when it flips).
  const deferredRef = useRef(false);
  // Set once an outage is detected while deferred; flushed by the popup's gate.
  const pendingOutageRef = useRef(false);

  // Actually reveal the modal (snapshotting the current onRecover). Used by the
  // non-deferred poll path, by flushOutage, and by setDeferred's release path.
  const showOutageModal = useCallback(() => {
    if (modalOpenRef.current) return;
    onRecoverRef.current = watchRef.current?.onRecover ?? null;
    modalOpenRef.current = true;
    setModalOpen(true);
  }, []);

  const openOutage = useCallback(() => {
    if (modalOpenRef.current) return;
    // Confirmation popup is up: arm silently, don't interrupt the user.
    if (deferredRef.current) {
      pendingOutageRef.current = true;
      return;
    }
    showOutageModal();
  }, [showOutageModal]);

  // Confirm a single failure with one immediate re-check before declaring an
  // outage, so a transient blip doesn't false-positive. Re-validate before and
  // after each await that this service is still watched and the modal isn't open.
  const evaluate = useCallback(async (service: BackendService) => {
    const stale = () => modalOpenRef.current || watchRef.current?.service !== service;
    if (stale()) return;

    const ok = await checkHealth(service);
    if (ok) { pendingOutageRef.current = false; return; }
    if (stale()) return;

    const okRetry = await checkHealth(service);
    if (okRetry) { pendingOutageRef.current = false; return; }
    if (stale()) return;

    openOutage();
  }, [openOutage]);

  const register = useCallback((id: string, service: BackendService, onRecover: () => void) => {
    watchRef.current = { id, service, onRecover };
    setActiveService(service);
  }, []);

  const unregister = useCallback((id: string) => {
    // Only clear if this id still owns the watch — guards against an unmounting
    // page wiping a newly mounted page's watch.
    if (watchRef.current?.id !== id) return;
    watchRef.current = null;
    setActiveService(null);
    // Reset the deferral/armed state with the watch. These belong to the watch
    // that just went away; leaving them set would leak a stale armed outage into
    // the next, unrelated watch (its setDeferred release path would fire a
    // spurious modal against a healthy backend).
    deferredRef.current = false;
    pendingOutageRef.current = false;
  }, []);

  const requestImmediateCheck = useCallback((id: string) => {
    const w = watchRef.current;
    if (!w || w.id !== id) return;
    void evaluate(w.service);
  }, [evaluate]);

  const setDeferred = useCallback((id: string, deferred: boolean) => {
    if (watchRef.current?.id !== id) return;
    deferredRef.current = deferred;
    // Releasing deferral while an outage is armed (watch still live, modal not
    // already up) reveals the modal now — covers a popup that closes by a path
    // other than a flushed click.
    if (!deferred && pendingOutageRef.current && !modalOpenRef.current) {
      pendingOutageRef.current = false;
      showOutageModal();
    }
  }, [showOutageModal]);

  const flushOutage = useCallback((id: string): boolean => {
    const w = watchRef.current;
    if (!w || w.id !== id || !pendingOutageRef.current) return false;
    pendingOutageRef.current = false;
    showOutageModal();
    return true;
  }, [showOutageModal]);

  // Poll the active service while a watch is live and the modal isn't open.
  useEffect(() => {
    if (!activeService || modalOpen) return;
    let cancelled = false;

    // Skip the network check while the tab is hidden — the modal isn't visible
    // anyway, and the next tick after the user returns re-checks within POLL_MS.
    const run = () => { if (!cancelled && !document.hidden) void evaluate(activeService); };

    // Immediate check on activation (covers initial-request failures), deferred
    // a tick so it isn't a synchronous setState within the effect body.
    const immediate = setTimeout(run, 0);
    const interval = setInterval(run, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [activeService, modalOpen, evaluate]);

  const handleAcknowledge = useCallback(() => {
    modalOpenRef.current = false;
    setModalOpen(false);
    const recover = onRecoverRef.current;
    onRecoverRef.current = null;
    // Clear the watch; the recovering page tears down / navigates anyway.
    watchRef.current = null;
    setActiveService(null);
    deferredRef.current = false;
    pendingOutageRef.current = false;
    recover?.();
  }, []);

  const value = useMemo<BackendMonitorContextValue>(() => ({
    register,
    unregister,
    requestImmediateCheck,
    setDeferred,
    flushOutage,
  }), [register, unregister, requestImmediateCheck, setDeferred, flushOutage]);

  return (
    <BackendMonitorContext.Provider value={value}>
      {children}
      <ServiceUnavailableModal open={modalOpen} onAcknowledge={handleAcknowledge} />
    </BackendMonitorContext.Provider>
  );
}

function useBackendMonitor(): BackendMonitorContextValue {
  const ctx = useContext(BackendMonitorContext);
  if (!ctx) {
    throw new Error('useBackendWatch must be used within a BackendMonitorProvider');
  }
  return ctx;
}

interface UseBackendWatchOptions {
  active: boolean;
  service: BackendService;
  onRecover: () => void;
  recheckSignal?: unknown;
  deferred?: boolean;
}

export function useBackendWatch({ active, service, onRecover, recheckSignal, deferred }: UseBackendWatchOptions) {
  const monitor = useBackendMonitor();
  const id = useId();

  // Keep the latest onRecover without forcing re-registration each render.
  const onRecoverRef = useRef(onRecover);
  useEffect(() => {
    onRecoverRef.current = onRecover;
  }, [onRecover]);

  // Register while active; clear on inactivity/unmount.
  useEffect(() => {
    if (!active) return;
    monitor.register(id, service, () => onRecoverRef.current());
    return () => monitor.unregister(id);
  }, [active, service, id, monitor]);

  // While a confirmation popup is open, suppress the modal (arm instead). The
  // gate flushes the armed outage on the next interaction.
  useEffect(() => {
    if (!active) return;
    monitor.setDeferred(id, !!deferred);
  }, [deferred, active, id, monitor]);

  // Hybrid accelerator: when recheckSignal flips while active, ask for an
  // instant health check instead of waiting for the next poll.
  useEffect(() => {
    if (!active) return;
    monitor.requestImmediateCheck(id);
  }, [recheckSignal, active, id, monitor]);

  // Capture-phase click handler for confirmation popups: if an outage is armed,
  // open the modal and swallow the click so the popup's own button never fires.
  const outageGate = useCallback((e: React.MouseEvent) => {
    if (monitor.flushOutage(id)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [monitor, id]);

  return { outageGate };
}
