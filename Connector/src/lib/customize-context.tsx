'use client';

import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import { fetchWsToken } from './ws-token';

const WS_BASE_URL = process.env.NEXT_PUBLIC_CUSTOMIZE_WS_URL || 'ws://localhost:8002';

export type CustomizePhase = 'idle' | 'preparing' | 'executing' | 'building' | 'build_fixing' | 'completed' | 'error' | 'saving';

export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  num: number;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface DiffPreview {
  request_id: number;
  file_path: string;
  hunks: DiffHunk[];
  status: 'pending' | 'approved' | 'rejected';
  new_file?: boolean;
  overwrite?: boolean;
  omitted?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  type: 'text' | 'diff' | 'interrupted' | 'save_result' | 'file_event';
  content?: string;
  diff?: DiffPreview;
  saveResult?: { success: boolean; message: string; url?: string };
  timestamp: string;
}

export type BuilderStatus = 'idle' | 'running' | 'passed' | 'fixing' | 'failed';

interface ProjectCustomizeState {
  phase: CustomizePhase;
  chatMessages: ChatMessage[];
  changesMade: boolean;
  builderStatus: BuilderStatus;
  grantAll: boolean;
}

interface CustomizeContextValue {
  startCustomize: (projectId: string) => Promise<void>;
  getCustomizeState: (projectId: string) => ProjectCustomizeState;
  sendChatMessage: (projectId: string, message: string) => void;
  respondToDiff: (projectId: string, requestId: number, approved: boolean) => void;
  grantAllCustomize: (projectId: string) => void;
  resetCustomize: (projectId: string) => void;
  closeCustomize: (projectId: string, discard?: boolean) => Promise<void>;
}

const CustomizeContext = createContext<CustomizeContextValue | null>(null);

export function useCustomize() {
  const context = useContext(CustomizeContext);
  if (!context) {
    throw new Error('useCustomize must be used within a CustomizeProvider');
  }
  return context;
}

const DEFAULT_STATE: ProjectCustomizeState = {
  phase: 'idle',
  chatMessages: [],
  changesMade: false,
  builderStatus: 'idle',
  grantAll: false,
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getOrDefault(states: Record<string, ProjectCustomizeState>, pid: string): ProjectCustomizeState {
  return states[pid] ?? { ...DEFAULT_STATE };
}

const STATUS_MAP: Record<string, CustomizePhase> = {
  running: 'idle',
  preparing: 'preparing',
  executing: 'executing',
  building: 'building',
  build_fixing: 'build_fixing',
  completed: 'completed',
  saving: 'saving',
  error: 'error',
};

export function CustomizeProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<Record<string, ProjectCustomizeState>>({});
  const wsRefs = useRef<Record<string, WebSocket>>({});

  const getCustomizeState = useCallback((projectId: string): ProjectCustomizeState => {
    return getOrDefault(states, projectId);
  }, [states]);

  function updateProject(
    projectId: string,
    patch: (s: ProjectCustomizeState) => Partial<ProjectCustomizeState>,
  ) {
    setStates(prev => {
      const existing = getOrDefault(prev, projectId);
      return { ...prev, [projectId]: { ...existing, ...patch(existing) } };
    });
  }

  function addChatMessage(projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    updateProject(projectId, existing => ({
      chatMessages: [
        ...existing.chatMessages,
        { ...msg, id: genId(), timestamp: new Date().toISOString() },
      ],
    }));
  }

  function createWsMessageHandler(projectId: string) {
    return (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status': {
          const phase = STATUS_MAP[data.status] || 'error';
          updateProject(projectId, () => ({ phase }));
          break;
        }

        case 'message': {
          const msgData = data.data;
          if (msgData?.type === 'error') {
            addChatMessage(projectId, {
              role: 'agent',
              type: 'text',
              content: msgData.content,
            });
          }
          break;
        }

        case 'diff_preview': {
          const incoming = data.data as {
            request_id: number; file_path: string; hunks: DiffHunk[];
            new_file?: boolean; overwrite?: boolean; omitted?: number;
          };
          updateProject(projectId, existing => {
            // Each edit is its own gate (unique request_id); de-dupe in case a
            // poll re-sends it. Under Grant All the box renders read-only/applied.
            if (existing.chatMessages.some(m => m.type === 'diff' && m.diff?.request_id === incoming.request_id)) {
              return {};
            }
            const diff: DiffPreview = { ...incoming, status: existing.grantAll ? 'approved' : 'pending' };
            return {
              chatMessages: [
                ...existing.chatMessages,
                { id: genId(), role: 'agent' as const, type: 'diff' as const, diff, timestamp: new Date().toISOString() },
              ],
            };
          });
          break;
        }

        case 'builder_status': {
          const bStatus = data.data?.status || 'idle';
          if (bStatus === 'passed' || bStatus === 'failed') {
            updateProject(projectId, () => ({ builderStatus: 'idle' }));
            addChatMessage(projectId, {
              role: 'agent',
              type: 'text',
              content: bStatus === 'passed'
                ? 'All changes have been implemented'
                : 'Build has unresolved issues',
            });
          } else {
            updateProject(projectId, () => ({ builderStatus: bStatus }));
          }
          break;
        }

        case 'result': {
          updateProject(projectId, () => ({
            phase: 'completed',
            changesMade: data.data?.changes_made || false,
          }));
          if (!data.data?.changes_made) {
            addChatMessage(projectId, {
              role: 'agent',
              type: 'text',
              content: 'Customization complete. No changes were applied.',
            });
          }
          break;
        }

        case 'save_result': {
          addChatMessage(projectId, {
            role: 'agent',
            type: 'save_result',
            saveResult: data.data,
            content: data.data?.message || '',
          });
          break;
        }

        case 'file_event': {
          const action = data.data?.action;
          const kind: string = data.data?.kind || 'file';
          const path: string = data.data?.path || '';
          const baseName = (p: string) => p.split('/').pop() || p;
          const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
          const name = baseName(path);
          const noun = kind === 'folder' ? 'folder ' : '';
          let content: string;
          if (action === 'deleted') {
            content = `Deleting ${noun}${name}.`;
          } else if (action === 'renamed') {
            const from = baseName(data.data?.from || '');
            content = `Renaming ${noun}${from} to ${name}.`;
          } else {
            const dir = dirOf(path);
            content = dir
              ? `Creating ${noun}${name} in ${dir}/.`
              : `Creating ${noun}${name} in the project root.`;
          }
          addChatMessage(projectId, { role: 'agent', type: 'file_event', content });
          break;
        }

        case 'error': {
          addChatMessage(projectId, {
            role: 'agent',
            type: 'text',
            content: data.data || 'An error occurred',
          });
          break;
        }
      }
    };
  }

  async function connectWs(projectId: string): Promise<WebSocket> {
    const wsToken = await fetchWsToken('customize');
    const base = `${WS_BASE_URL}/ws/customize/${projectId}`;

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base);

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: 'start' }));
        wsRefs.current[projectId] = ws;
        ws.onerror = () => {
          delete wsRefs.current[projectId];
        };
        resolve(ws);
      };
      ws.onmessage = createWsMessageHandler(projectId);
      ws.onerror = () => {
        reject(new Error('connection_failed'));
      };
      ws.onclose = () => {
        delete wsRefs.current[projectId];
      };
    });
  }

  const startCustomize = useCallback(async (projectId: string) => {
    wsRefs.current[projectId]?.close();
    setStates(prev => ({ ...prev, [projectId]: { ...DEFAULT_STATE } }));
  }, []);

  const sendChatMessage = useCallback(async (projectId: string, message: string) => {
    addChatMessage(projectId, {
      role: 'user',
      type: 'text',
      content: message,
    });

    let ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      try {
        ws = await connectWs(projectId);
      } catch {
        addChatMessage(projectId, {
          role: 'agent',
          type: 'text',
          content: 'Agent is currently not available.',
        });
        return;
      }
    }

    ws.send(JSON.stringify({
      action: 'chat',
      data: { message },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- addChatMessage/connectWs are stable; this sender is intentionally created once
  }, []);

  const respondToDiff = useCallback((projectId: string, requestId: number, approved: boolean) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    updateProject(projectId, existing => ({
      changesMade: existing.changesMade || approved,
      chatMessages: existing.chatMessages.map(msg =>
        msg.type === 'diff' && msg.diff?.request_id === requestId
          ? { ...msg, diff: { ...msg.diff!, status: approved ? 'approved' as const : 'rejected' as const } }
          : msg
      ),
    }));

    ws.send(JSON.stringify({
      action: 'diff_response',
      data: { request_id: requestId, approved },
    }));
  }, []);

  const grantAllCustomize = useCallback((projectId: string) => {
    // Tell the backend to auto-approve every gate for the rest of the session,
    // and flip any still-pending boxes to read-only ("applied") locally.
    updateProject(projectId, existing => ({
      grantAll: true,
      chatMessages: existing.chatMessages.map(msg =>
        msg.type === 'diff' && msg.diff?.status === 'pending'
          ? { ...msg, diff: { ...msg.diff!, status: 'approved' as const } }
          : msg
      ),
    }));
    const ws = wsRefs.current[projectId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'grant_all' }));
    }
  }, []);

  const resetCustomize = useCallback((projectId: string) => {
    wsRefs.current[projectId]?.close();
    delete wsRefs.current[projectId];
    setStates(prev => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  // Closing the chat resets local state and fully tears down the backend session
  // (runner, agent, daemon, work/). With discard=true the project's edited files
  // are deleted too; otherwise they persist so a later reopen resumes from the
  // last edits.
  const closeCustomize = useCallback(async (projectId: string, discard = false) => {
    resetCustomize(projectId);
    try {
      await fetch('/api/customize/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, discard }),
      });
    } catch {
      // best-effort teardown; the next open re-validates and starts fresh
    }
  }, [resetCustomize]);

  const value = useMemo<CustomizeContextValue>(() => ({
    startCustomize,
    getCustomizeState,
    sendChatMessage,
    respondToDiff,
    grantAllCustomize,
    resetCustomize,
    closeCustomize,
  }), [startCustomize, getCustomizeState, sendChatMessage, respondToDiff, grantAllCustomize, resetCustomize, closeCustomize]);

  return (
    <CustomizeContext.Provider value={value}>
      {children}
    </CustomizeContext.Provider>
  );
}
