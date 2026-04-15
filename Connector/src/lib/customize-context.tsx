'use client';

import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';

const WS_BASE_URL = process.env.NEXT_PUBLIC_CUSTOMIZE_WS_URL || 'ws://localhost:8002';

export type CustomizePhase = 'idle' | 'preparing' | 'executing' | 'waiting_diff' | 'building' | 'build_fixing' | 'completed' | 'error' | 'saving';

export interface DiffLine {
  type: 'ctx' | 'add' | 'del';
  num: number;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface DiffPreview {
  diff_id: string;
  file_path: string;
  hunks: DiffHunk[];
  status: 'pending' | 'approved' | 'rejected';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  type: 'text' | 'diff' | 'interrupted' | 'save_result';
  content?: string;
  diff?: DiffPreview;
  saveResult?: { success: boolean; message: string; url?: string };
  timestamp: string;
}

export type BuilderStatus = 'idle' | 'running' | 'passed' | 'fixing' | 'failed';

interface ProjectCustomizeState {
  phase: CustomizePhase;
  chatMessages: ChatMessage[];
  projectName: string;
  changesMade: boolean;
  currentDiff: DiffPreview | null;
  builderStatus: BuilderStatus;
  saveResult: { success: boolean; message: string; url?: string } | null;
}

interface CustomizeContextValue {
  startCustomize: (projectId: string, projectName: string, projectType: string) => Promise<void>;
  getCustomizeState: (projectId: string) => ProjectCustomizeState;
  sendChatMessage: (projectId: string, message: string) => void;
  respondToDiff: (projectId: string, diffId: string, approved: boolean) => void;
  saveChanges: (projectId: string) => void;
  discardChanges: (projectId: string) => void;
  resetCustomize: (projectId: string) => void;
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
  projectName: '',
  changesMade: false,
  currentDiff: null,
  builderStatus: 'idle',
  saveResult: null,
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function fetchWsToken(): Promise<string> {
  try {
    const res = await fetch('/api/customize/ws-token');
    if (!res.ok) return '';
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
  }
}

const STATUS_MAP: Record<string, CustomizePhase> = {
  running: 'idle',
  preparing: 'preparing',
  executing: 'executing',
  waiting_diff: 'waiting_diff',
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
    return states[projectId] || { ...DEFAULT_STATE };
  }, [states]);

  function getOrDefault(states: Record<string, ProjectCustomizeState>, pid: string): ProjectCustomizeState {
    return states[pid] ?? { ...DEFAULT_STATE };
  }

  function addChatMessage(projectId: string, msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
    setStates(prev => {
      const existing = getOrDefault(prev, projectId);
      return {
        ...prev,
        [projectId]: {
          ...existing,
          chatMessages: [
            ...existing.chatMessages,
            { ...msg, id: genId(), timestamp: new Date().toISOString() },
          ],
        },
      };
    });
  }

  function createWsMessageHandler(projectId: string) {
    return (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'status': {
          const phase = STATUS_MAP[data.status] || 'error';
          setStates(prev => ({
            ...prev,
            [projectId]: { ...getOrDefault(prev, projectId), phase },
          }));
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
          const diff: DiffPreview = { ...data.data, status: 'pending' };
          setStates(prev => ({
            ...prev,
            [projectId]: {
              ...getOrDefault(prev, projectId),
              currentDiff: diff,
              phase: 'waiting_diff',
            },
          }));
          addChatMessage(projectId, {
            role: 'agent',
            type: 'diff',
            diff,
          });
          break;
        }

        case 'builder_status': {
          const bStatus = data.data?.status || 'idle';
          setStates(prev => ({
            ...prev,
            [projectId]: { ...getOrDefault(prev, projectId), builderStatus: bStatus },
          }));
          break;
        }

        case 'result': {
          setStates(prev => ({
            ...prev,
            [projectId]: {
              ...getOrDefault(prev, projectId),
              phase: 'completed',
              changesMade: data.data?.changes_made || false,
            },
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
          setStates(prev => ({
            ...prev,
            [projectId]: {
              ...getOrDefault(prev, projectId),
              saveResult: data.data,
            },
          }));
          addChatMessage(projectId, {
            role: 'agent',
            type: 'save_result',
            saveResult: data.data,
            content: data.data?.message || '',
          });
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
    const wsToken = await fetchWsToken();
    const base = `${WS_BASE_URL}/ws/customize/${projectId}`;

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base);

      ws.onopen = () => {
        ws.send(JSON.stringify({ action: 'start' }));
        wsRefs.current[projectId] = ws;
        // Replace the initial error handler with a runtime one
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

  const startCustomize = useCallback(async (projectId: string, projectName: string, projectType: string) => {
    wsRefs.current[projectId]?.close();

    setStates(prev => ({
      ...prev,
      [projectId]: {
        ...DEFAULT_STATE,
        projectName,
      },
    }));

    // Don't connect eagerly — connection happens on first message send
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
  }, []);

  const respondToDiff = useCallback((projectId: string, diffId: string, approved: boolean) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Update the diff message status
    setStates(prev => {
      const existing = getOrDefault(prev, projectId);
      return {
        ...prev,
        [projectId]: {
          ...existing,
          currentDiff: null,
          changesMade: existing.changesMade || approved,
          chatMessages: existing.chatMessages.map(msg =>
            msg.type === 'diff' && msg.diff?.diff_id === diffId
              ? { ...msg, diff: { ...msg.diff!, status: approved ? 'approved' as const : 'rejected' as const } }
              : msg
          ),
        },
      };
    });

    ws.send(JSON.stringify({
      action: 'diff_response',
      data: { diff_id: diffId, approved },
    }));
  }, []);

  const saveChanges = useCallback((projectId: string) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ action: 'save' }));
  }, []);

  const discardChanges = useCallback((projectId: string) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ action: 'discard' }));
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

  const value = useMemo<CustomizeContextValue>(() => ({
    startCustomize,
    getCustomizeState,
    sendChatMessage,
    respondToDiff,
    saveChanges,
    discardChanges,
    resetCustomize,
  }), [startCustomize, getCustomizeState, sendChatMessage, respondToDiff, saveChanges, discardChanges, resetCustomize]);

  return (
    <CustomizeContext.Provider value={value}>
      {children}
    </CustomizeContext.Provider>
  );
}
