'use client';

import { useState, useRef, useEffect } from 'react';
import { useCustomize, type DiffPreview, type DiffLine, type BuilderStatus } from '@/lib/customize-context';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}


function DiffLineRow({ line }: { line: DiffLine }) {
  const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  const color = line.type === 'add' ? 'text-green-400' : line.type === 'del' ? 'text-red-400' : 'text-black dark:text-white';

  return (
    <div className="flex">
      <span className="w-10 text-right px-1.5 text-gray-600 select-none text-[11px] shrink-0">
        {line.num}
      </span>
      <span className={`w-4.5 text-center font-bold select-none shrink-0 ${color}`}>
        {prefix}
      </span>
      <span className={`flex-1 pr-3.5 whitespace-pre ${color}`}>
        {line.text}
      </span>
    </div>
  );
}

function HunkSeparator() {
  return (
    <div className="flex items-center">
      <span className="w-10 text-right px-1.5 text-indigo-500 select-none text-[11px] shrink-0">···</span>
    </div>
  );
}

function DiffView({ diff, footer }: { diff: DiffPreview; footer?: React.ReactNode }) {
  const hunks = diff.hunks || [];
  const allLines = hunks.flatMap(h => h.lines);
  const added = allLines.filter(l => l.type === 'add').length;
  const removed = allLines.filter(l => l.type === 'del').length;
  const displayPath = diff.file_path.replace(/^\/workspace\/codebase\/(edited\/)?/, '');

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-border bg-white dark:bg-[#161616]">
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#f0ead6] dark:bg-[#1c1c1c] border-b border-border">
        <span className="text-xs font-semibold font-mono text-black dark:text-[#e2e8f0] truncate mr-3">{displayPath}</span>
        <div className="flex gap-2.5 text-[11px] font-mono shrink-0">
          <span className="text-green-400">+{added}</span>
          <span className="text-red-400">-{removed}</span>
        </div>
      </div>
      <div className="max-h-96 overflow-auto text-xs leading-[21px] font-mono scrollbar-hidden">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {hunkIdx > 0 && <HunkSeparator />}
            {hunk.lines.map((line, i) => (
              <DiffLineRow key={`${hunkIdx}-${i}`} line={line} />
            ))}
          </div>
        ))}
      </div>
      {footer && (
        <div className="flex items-center justify-end gap-1.5 px-2.5 py-1 bg-[#f0ead6] dark:bg-[#1c1c1c] border-t border-border">
          {footer}
        </div>
      )}
    </div>
  );
}


function ApprovalButtons({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <>
      <button
        onClick={onReject}
        className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 transition"
        title="Reject"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18" /><path d="M6 6l12 12" />
        </svg>
      </button>
      <button
        onClick={onApprove}
        className="p-1.5 rounded-md text-green-500 hover:bg-green-500/10 transition"
        title="Approve"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </button>
    </>
  );
}


function ThinkingDots({ label = 'Thinking' }: { label?: string }) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(iv);
  }, []);
  return <span className="text-blue-400">{label}{dots}</span>;
}


function BuilderStatusIndicator({ status }: { status: BuilderStatus }) {
  if (status === 'idle') return null;

  const config: Record<string, { label: string; color: string; animate: boolean }> = {
    running: { label: 'Verifying the build', color: 'text-amber-400', animate: true },
    fixing: { label: 'Fixing issues', color: 'text-amber-400', animate: true },
    passed: { label: 'All changes have been implemented', color: 'text-foreground', animate: false },
    failed: { label: 'Build has unresolved issues', color: 'text-red-400', animate: false },
  };

  const c = config[status] || config.running;

  return (
    <div className="pl-7 mt-2">
      <span className={`text-sm ${c.color}`}>{c.animate ? <ThinkingDots label={c.label} /> : c.label}</span>
    </div>
  );
}


function ChatInput({ input, onChange, onKeyDown, onSend, canSend }: {
  input: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  canSend: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const MAX_VISIBLE_LINES = 6;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 21;
    const maxHeight = lineHeight * MAX_VISIBLE_LINES;
    const contentHeight = ta.scrollHeight;
    ta.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    ta.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    if (contentHeight <= maxHeight) {
      ta.scrollTop = 0;
    }
  }, [input]);

  return (
    <div className="flex items-end gap-3 bg-surface border border-border rounded-2xl px-4 py-3">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="What UI tweak do you want to implement?"
        rows={1}
        className="flex-1 bg-transparent text-foreground placeholder-muted outline-none resize-none text-sm scrollbar-hidden"
      />
      {input.trim() && (
        <button
          onClick={onSend}
          disabled={!canSend}
          className={`p-2 rounded-lg bg-blue-600 text-white transition ${canSend ? 'hover:bg-blue-700' : 'opacity-40 cursor-not-allowed'}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}


export default function ChatInterface({
  username,
  onExit,
  projectId,
}: {
  username: string;
  onExit: () => void;
  projectId: string;
}) {
  const { getCustomizeState, sendChatMessage, respondToDiff } = useCustomize();
  const state = getCustomizeState(projectId);
  const [input, setInput] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = state.chatMessages ?? [];
  const phase = state.phase ?? 'idle';
  const builderStatus = state.builderStatus ?? 'idle';
  const isBusy = ['preparing', 'planning', 'executing', 'building', 'build_fixing', 'saving'].includes(phase);
  const canSend = !isBusy;

  useEffect(() => {
    if (!autoApprove) return;
    for (const msg of messages) {
      if (msg.type === 'diff' && msg.diff?.status === 'pending') {
        respondToDiff(projectId, msg.diff.diff_id, true);
      }
    }
  }, [autoApprove, messages, projectId, respondToDiff]);

  useEffect(() => {
    if (autoApprove) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setAutoApprove(true);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [autoApprove]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || !canSend) return;
    sendChatMessage(projectId, text);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) handleSend();
    }
  }

  const greeting = getGreeting();
  const displayName = username || 'there';

  return (
    <div className="fixed inset-0 z-50 bg-header flex flex-col">
      <div className="flex items-center justify-end p-4">
        <button
          onClick={onExit}
          className="p-2 text-muted hover:text-foreground rounded-lg transition"
          title="Back to code view"
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8.78362 8.78412C8.49073 9.07702 8.49073 9.55189 8.78362 9.84478L10.9388 12L8.78362 14.1552C8.49073 14.4481 8.49073 14.923 8.78362 15.2159C9.07652 15.5088 9.55139 15.5088 9.84428 15.2159L11.9995 13.0607L14.1546 15.2158C14.4475 15.5087 14.9224 15.5087 15.2153 15.2158C15.5082 14.9229 15.5082 14.448 15.2153 14.1551L13.0602 12L15.2153 9.84485C15.5082 9.55196 15.5082 9.07708 15.2153 8.78419C14.9224 8.4913 14.4475 8.4913 14.1546 8.78419L11.9995 10.9393L9.84428 8.78412C9.55139 8.49123 9.07652 8.49123 8.78362 8.78412Z" fill="currentColor"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM3.5 12C3.5 7.30558 7.30558 3.5 12 3.5C16.6944 3.5 20.5 7.30558 20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C7.30558 20.5 3.5 16.6944 3.5 12Z" fill="currentColor"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-0 scrollbar-hidden">
        <div className={`flex flex-col items-center max-w-3xl mx-auto ${messages.length === 0 ? 'justify-center h-full pb-40' : 'justify-start pt-4'}`}>
          {messages.length === 0 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground mb-8">
                Good {greeting}, {displayName}
              </h1>
              <div className="w-full">
                <ChatInput
                  input={input}
                  onChange={setInput}
                  onKeyDown={handleKeyDown}
                  onSend={handleSend}
                  canSend={canSend}
                />
              </div>
            </>
          ) : (
            <div className="w-full space-y-5 self-start pt-0 pb-4">
              {(() => {
                const firstDiffIndex = messages.findIndex(m => m.type === 'diff');
                return messages.map((msg, msgIndex) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl px-4 py-3 text-sm bg-[#e7feff] text-black dark:bg-blue-600 dark:text-white whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                if (msg.type === 'diff' && msg.diff) {
                  const footer = msg.diff.status === 'pending' ? (
                    <ApprovalButtons
                      onApprove={() => respondToDiff(projectId, msg.diff!.diff_id, true)}
                      onReject={() => respondToDiff(projectId, msg.diff!.diff_id, false)}
                    />
                  ) : (
                    <span className={`text-xs font-semibold ${msg.diff.status === 'approved' ? 'text-green-400' : 'text-red-400'}`}>
                      {msg.diff.status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                  );
                  const showAutoApprovePrompt = msgIndex === firstDiffIndex && !autoApprove;
                  return (
                    <div key={msg.id} className="pl-7">
                      <DiffView diff={msg.diff} footer={footer} />
                      {showAutoApprovePrompt && (
                        <button
                          onClick={() => setAutoApprove(true)}
                          className="mt-2 w-full text-center text-base text-muted hover:text-foreground transition cursor-pointer"
                        >
                          Grant permission for all edits during this session? <span className="text-sm opacity-60">(Shift + Enter)</span>
                        </button>
                      )}
                    </div>
                  );
                }

                if (msg.type === 'save_result' && msg.saveResult) {
                  return (
                    <div key={msg.id} className="pl-7">
                      <div className={`rounded-xl border p-4 text-sm ${
                        msg.saveResult.success
                          ? 'border-green-800 bg-green-900/20 text-green-300'
                          : 'border-red-800 bg-red-900/20 text-red-300'
                      }`}>
                        <p>{msg.saveResult.message}</p>
                        {msg.saveResult.url && (
                          <a
                            href={msg.saveResult.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline mt-1 inline-block text-blue-400"
                          >
                            {msg.saveResult.url}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="pl-7">
                      <div className="text-sm text-foreground leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              });
              })()}

              {builderStatus !== 'idle' && (
                <BuilderStatusIndicator status={builderStatus} />
              )}

              {(phase === 'preparing' || phase === 'executing' || phase === 'saving') && (
                <div className="pl-7">
                  <ThinkingDots label={phase === 'preparing' ? 'Gathering codebase context' : 'Thinking'} />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {messages.length > 0 && (
        <div className="px-6 pb-6 pt-2 max-w-3xl mx-auto w-full">
          <ChatInput
            input={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            canSend={canSend}
          />
        </div>
      )}
    </div>
  );
}
