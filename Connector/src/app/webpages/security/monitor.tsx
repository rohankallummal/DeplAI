'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useScan, type ScanMessage } from '@/lib/scan-context';

interface MonitorProps {
  projectId: string;
  onOpenChange?: (open: boolean) => void;
}

const MESSAGE_STYLES: Record<string, { color: string; prefix: string }> = {
  success: { color: 'text-green-400', prefix: '[+]' },
  warning: { color: 'text-yellow-400', prefix: '[!]' },
  phase:   { color: 'text-blue-400 font-bold', prefix: '' },
  error:   { color: 'text-red-500', prefix: '[ERR]' },
  info:    { color: 'text-gray-300', prefix: '[*]' },
};

const STATUS_CONFIG: Record<string, { dot: string; label: string }> = {
  running:   { dot: 'bg-green-500', label: 'Running' },
  completed: { dot: 'bg-blue-500', label: 'Completed' },
  error:     { dot: 'bg-red-500', label: 'Error' },
};

export default function Monitor({ projectId, onOpenChange }: MonitorProps) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { getScanState, getRemediationState } = useScan();
  const { state: scanState, messages: scanMessages } = getScanState(projectId);
  const { state: remState, messages: remMessages } = getRemediationState(projectId);

  const isRemediating = remState === 'running' || remState === 'completed' || remState === 'error';
  const activeState = isRemediating ? remState : scanState;

  const messages = useMemo<ScanMessage[]>(() => {
    if (!isRemediating) return scanMessages;
    return [...scanMessages, ...remMessages];
  }, [isRemediating, scanMessages, remMessages]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [messages.length]);

  function handleClose() {
    setTerminalOpen(false);
    onOpenChange?.(false);
  }

  const { dot: statusDotColor, label: statusLabel } = STATUS_CONFIG[activeState] || { dot: 'bg-gray-400', label: 'Idle' };

  const headerEl = typeof document !== 'undefined' ? document.querySelector('header') : null;
  const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 0;

  return (
    <>
      <button
        onClick={() => {
          const next = !terminalOpen;
          setTerminalOpen(next);
          onOpenChange?.(next);
        }}
        className={`p-2 rounded-lg transition ${
          terminalOpen
            ? 'bg-[#fffafa] dark:bg-surface-hover text-foreground'
            : 'text-muted hover:text-foreground hover:bg-[#fffafa] dark:hover:bg-surface-hover'
        }`}
        title="Monitor"
        aria-label="Monitor"
      >
        <svg width="24" height="24" viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15.0582 4.16286C15.1481 3.75851 14.8931 3.35788 14.4888 3.26802C14.0844 3.17816 13.6838 3.43311 13.5939 3.83746L10.0384 19.8374C9.94851 20.2418 10.2035 20.6424 10.6078 20.7323C11.0122 20.8221 11.4128 20.5672 11.5026 20.1628L15.0582 4.16286Z" fill="currentColor"/>
          <path d="M7.82913 7.46956C8.12204 7.76244 8.12206 8.23732 7.82918 8.53022L4.35946 12.0003L7.82916 15.47C8.12205 15.7628 8.12205 16.2377 7.82916 16.5306C7.53627 16.8235 7.06139 16.8235 6.7685 16.5306L2.7685 12.5306C2.47561 12.2377 2.4756 11.7629 2.76847 11.47L6.76847 7.46961C7.06135 7.1767 7.53623 7.17668 7.82913 7.46956Z" fill="currentColor"/>
          <path d="M17.2685 7.46956C16.9756 7.76244 16.9756 8.23732 17.2685 8.53022L20.7382 12.0003L17.2685 15.47C16.9756 15.7628 16.9756 16.2377 17.2685 16.5306C17.5614 16.8235 18.0363 16.8235 18.3292 16.5306L22.3292 12.5306C22.622 12.2377 22.6221 11.7629 22.3292 11.47L18.3292 7.46961C18.0363 7.1767 17.5614 7.17668 17.2685 7.46956Z" fill="currentColor"/>
        </svg>
      </button>

      {terminalOpen && (
        <div
          className="fixed z-50 flex flex-col"
          style={{ top: headerBottom, left: 0, right: 0, bottom: 0 }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 bg-surface border border-border select-none">
            <div className="flex items-center gap-2.5">
              <div className={`w-2 h-2 rounded-full ${statusDotColor} ${activeState === 'running' ? 'animate-pulse' : ''}`} />
              <span className="text-xs font-medium text-foreground">
                {isRemediating && activeState === 'running' ? 'Remediating' : statusLabel}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-muted hover:text-foreground rounded transition"
              aria-label="Close monitor"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div
            ref={terminalRef}
            className="monitor-terminal bg-[#0d1117] border border-t-0 border-border p-4 font-mono text-sm leading-relaxed overflow-y-auto flex-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#3b3b4f transparent' }}
          >
            {messages.length === 0 && (activeState === 'idle' || activeState === 'running') && (
              <div className="flex gap-3">
                <span className="text-green-400 animate-pulse">$$ / &#x2588;</span>
              </div>
            )}
            {messages.map((msg, i) => {
              const style = MESSAGE_STYLES[msg.type] || MESSAGE_STYLES.info;
              return (
                <div key={i} className="flex gap-2">
                  <span className={style.color}>
                    {style.prefix ? `${style.prefix} ${msg.content}` : msg.content}
                  </span>
                </div>
              );
            })}
            {activeState === 'running' && messages.length > 0 && (
              <div className="flex gap-3">
                <span className="text-green-400 animate-pulse">$$ / &#x2588;</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
