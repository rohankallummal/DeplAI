'use client';

import { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';

const WS_BASE_URL = process.env.NEXT_PUBLIC_DEPLOY_WS_URL || 'ws://localhost:8001';

export type DeployPhase = 'idle' | 'analyzing' | 'clarifying' | 'architecting' | 'terraforming' | 'costing' | 'completed' | 'error';

export interface DeployMessage {
  index: number;
  total: number;
  type: string;
  content: string;
  timestamp: string;
}

export interface ClarificationQuestion {
  id: string;
  category: string;
  question: string;
  options?: string[];
  context?: string;
}

export interface ChatMessage {
  role: 'agent' | 'user';
  content: string;
  questionId?: string;
  timestamp: string;
}

export interface CostData {
  total_monthly_cost: number;
  total_hourly_cost: number;
  resources: Array<{
    name: string;
    monthly_cost: number;
    components: Array<{
      name: string;
      monthly_cost: number;
      hourly_cost: number;
    }>;
  }>;
  error?: string;
}

interface ProjectDeployState {
  phase: DeployPhase;
  messages: DeployMessage[];
  projectName: string;
  questions: ClarificationQuestion[];
  chatMessages: ChatMessage[];
  answeredQuestions: Record<string, string>;
  currentQuestionIndex: number;
  costData: CostData | null;
}

interface DeployContextValue {
  startDeploy: (projectId: string, projectName: string) => Promise<void>;
  getDeployState: (projectId: string) => ProjectDeployState;
  sendAnswer: (projectId: string, questionId: string, answer: string) => void;
  submitAllAnswers: (projectId: string) => void;
  confirmDeploy: (projectId: string, confirmed: boolean) => void;
  activeDeployIds: string[];
  activeDeployProjectNames: Record<string, string>;
  resetDeploy: (projectId: string) => void;
  restoreDeployState: (projectId: string) => Promise<void>;
}

const DeployContext = createContext<DeployContextValue | null>(null);

export function useDeploy() {
  const context = useContext(DeployContext);
  if (!context) {
    throw new Error('useDeploy must be used within a DeployProvider');
  }
  return context;
}

const DEFAULT_STATE: ProjectDeployState = {
  phase: 'idle',
  messages: [],
  projectName: '',
  questions: [],
  chatMessages: [],
  answeredQuestions: {},
  currentQuestionIndex: 0,
  costData: null,
};

async function fetchWsToken(): Promise<string> {
  try {
    const res = await fetch('/api/deploy/ws-token');
    if (!res.ok) return '';
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
  }
}

const STATUS_MAP: Record<string, DeployPhase> = {
  running: 'analyzing',
  analyzing: 'analyzing',
  clarifying: 'clarifying',
  architecting: 'architecting',
  terraforming: 'terraforming',
  costing: 'costing',
  completed: 'completed',
  error: 'error',
};

const ACTIVE_PHASES: DeployPhase[] = ['analyzing', 'clarifying', 'architecting', 'terraforming', 'costing'];

export function DeployProvider({ children }: { children: React.ReactNode }) {
  const [states, setStates] = useState<Record<string, ProjectDeployState>>({});
  const wsRefs = useRef<Record<string, WebSocket>>({});

  const getDeployState = useCallback((projectId: string): ProjectDeployState => {
    return states[projectId] || { ...DEFAULT_STATE };
  }, [states]);

  const activeDeployIds = useMemo(() => {
    return Object.entries(states)
      .filter(([, s]) => ACTIVE_PHASES.includes(s.phase))
      .map(([id]) => id);
  }, [states]);

  const activeDeployProjectNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const [id, s] of Object.entries(states)) {
      if (ACTIVE_PHASES.includes(s.phase)) {
        names[id] = s.projectName;
      }
    }
    return names;
  }, [states]);

  function createWsMessageHandler(projectId: string) {
    return (event: MessageEvent) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message':
          if (data.data?.type === 'error') {
            setStates(prev => {
              const existing = prev[projectId];
              if (!existing) return prev;
              return {
                ...prev,
                [projectId]: {
                  ...existing,
                  messages: [...existing.messages, data.data as DeployMessage],
                },
              };
            });
          }
          break;

        case 'status': {
          const phase = STATUS_MAP[data.status] || 'error';
          setStates(prev => ({
            ...prev,
            [projectId]: { ...prev[projectId], phase },
          }));
          break;
        }

        case 'cost_estimate': {
          const costData = data.data as CostData;
          setStates(prev => ({
            ...prev,
            [projectId]: { ...prev[projectId], costData, phase: 'costing' },
          }));
          break;
        }

        case 'questions': {
          const raw = data.data;
          const questions: ClarificationQuestion[] = Array.isArray(raw) ? raw : (raw?.questions || []);
          const chatMessages: ChatMessage[] = [];

          if (questions.length > 0) {
            chatMessages.push({
              role: 'agent',
              content: questions[0].question,
              questionId: questions[0].id,
              timestamp: new Date().toISOString(),
            });
          }

          setStates(prev => ({
            ...prev,
            [projectId]: {
              ...prev[projectId],
              questions,
              chatMessages: [...(prev[projectId]?.chatMessages || []), ...chatMessages],
              currentQuestionIndex: 0,
            },
          }));
          break;
        }
      }
    };
  }

  async function connectDeployWsWithToken(projectId: string): Promise<WebSocket> {
    const wsToken = await fetchWsToken();
    const base = `${WS_BASE_URL}/ws/deploy/${projectId}`;
    const ws = new WebSocket(wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base);

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'start' }));
    };
    ws.onmessage = createWsMessageHandler(projectId);
    ws.onerror = () => {
      setStates(prev => ({
        ...prev,
        [projectId]: { ...prev[projectId], phase: 'error' },
      }));
    };
    ws.onclose = () => {
      delete wsRefs.current[projectId];
    };

    wsRefs.current[projectId] = ws;
    return ws;
  }

  const startDeploy = useCallback(async (projectId: string, projectName: string) => {
    wsRefs.current[projectId]?.close();

    setStates(prev => ({
      ...prev,
      [projectId]: {
        ...DEFAULT_STATE,
        projectName,
      },
    }));

    try {
      const historyRes = await fetch(`/api/deploy/chat-history?project_id=${projectId}`);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        if (historyData.data) {
          const saved = historyData.data;
          const chatMessages: ChatMessage[] = [];
          const answeredQuestions: Record<string, string> = {};

          if (saved.questions && saved.answers) {
            for (const q of saved.questions) {
              chatMessages.push({
                role: 'agent',
                content: q.question,
                questionId: q.id,
                timestamp: new Date().toISOString(),
              });
              const answer = saved.answers.find((a: any) => a.id === q.id);
              if (answer) {
                chatMessages.push({
                  role: 'user',
                  content: answer.answer,
                  questionId: q.id,
                  timestamp: new Date().toISOString(),
                });
                answeredQuestions[q.id] = answer.answer;
              }
            }
          }

          if (chatMessages.length > 0) {
            setStates(prev => ({
              ...prev,
              [projectId]: {
                ...prev[projectId],
                chatMessages,
                answeredQuestions,
                questions: saved.questions || [],
                currentQuestionIndex: saved.questions?.length || 0,
              },
            }));
          }
        }
      }
    } catch {}

    await connectDeployWsWithToken(projectId);
  }, []);

  const sendAnswer = useCallback((projectId: string, questionId: string, answer: string) => {
    setStates(prev => {
      const existing = prev[projectId];
      if (!existing) return prev;

      const newAnswered = { ...existing.answeredQuestions, [questionId]: answer };
      const nextIndex = existing.currentQuestionIndex + 1;

      const newChatMessages = [
        ...existing.chatMessages,
        {
          role: 'user' as const,
          content: answer,
          questionId,
          timestamp: new Date().toISOString(),
        },
      ];

      if (nextIndex < existing.questions.length) {
        newChatMessages.push({
          role: 'agent' as const,
          content: existing.questions[nextIndex].question,
          questionId: existing.questions[nextIndex].id,
          timestamp: new Date().toISOString(),
        });
      }

      try {
        localStorage.setItem(
          `deplai_deploy_chat_${projectId}`,
          JSON.stringify({ chatMessages: newChatMessages, answeredQuestions: newAnswered })
        );
      } catch {}

      return {
        ...prev,
        [projectId]: {
          ...existing,
          answeredQuestions: newAnswered,
          chatMessages: newChatMessages,
          currentQuestionIndex: nextIndex,
        },
      };
    });
  }, []);

  const submitAllAnswers = useCallback((projectId: string) => {
    const state = states[projectId];
    if (!state) return;

    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const answers = state.questions.map(q => ({
      id: q.id,
      question: q.question,
      answer: state.answeredQuestions[q.id] || '',
    }));

    ws.send(JSON.stringify({
      action: 'answer',
      data: {
        questions: state.questions,
        answers,
      },
    }));
  }, [states]);

  const confirmDeploy = useCallback((projectId: string, confirmed: boolean) => {
    const ws = wsRefs.current[projectId];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      action: 'deploy_confirmation',
      data: {
        confirmed,
      },
    }));
  }, []);

  const resetDeploy = useCallback((projectId: string) => {
    wsRefs.current[projectId]?.close();
    delete wsRefs.current[projectId];
    setStates(prev => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    try {
      localStorage.removeItem(`deplai_deploy_chat_${projectId}`);
    } catch {}
  }, []);

  const restoreDeployState = useCallback(async (projectId: string) => {
    const current = states[projectId];
    if (current && ACTIVE_PHASES.includes(current.phase)) return;

    try {
      const res = await fetch(`/api/deploy/status?project_id=${projectId}`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.active) {
        let savedChat: { chatMessages: ChatMessage[]; answeredQuestions: Record<string, string> } | null = null;
        try {
          const stored = localStorage.getItem(`deplai_deploy_chat_${projectId}`);
          if (stored) savedChat = JSON.parse(stored);
        } catch {}

        setStates(prev => ({
          ...prev,
          [projectId]: {
            ...DEFAULT_STATE,
            phase: data.phase as DeployPhase || 'analyzing',
            projectName: prev[projectId]?.projectName || '',
            chatMessages: savedChat?.chatMessages || [],
            answeredQuestions: savedChat?.answeredQuestions || {},
          },
        }));

        await connectDeployWsWithToken(projectId);
      }
    } catch {}
  }, [states]);

  const value = useMemo<DeployContextValue>(() => ({
    startDeploy,
    getDeployState,
    sendAnswer,
    submitAllAnswers,
    confirmDeploy,
    activeDeployIds,
    activeDeployProjectNames,
    resetDeploy,
    restoreDeployState,
  }), [startDeploy, getDeployState, sendAnswer, submitAllAnswers, confirmDeploy, activeDeployIds, activeDeployProjectNames, resetDeploy, restoreDeployState]);

  return (
    <DeployContext.Provider value={value}>
      {children}
    </DeployContext.Provider>
  );
}
