'use client';

import { useState, useRef, useEffect } from 'react';
import { useCustomize, type ChatMessage, type DiffPreview, type DiffHunk, type DiffLine } from '@/lib/customize-context';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

/* ── Diff View ─────────────────────────────────────────────────── */

function DiffLineRow({ line }: { line: DiffLine }) {
  const bg = line.type === 'add' ? 'rgba(74,222,128,0.08)' : line.type === 'del' ? 'rgba(248,113,113,0.08)' : 'transparent';
  const borderColor = line.type === 'add' ? '#4ade80' : line.type === 'del' ? '#f87171' : 'transparent';
  const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  const prefixColor = line.type === 'add' ? 'text-green-400' : line.type === 'del' ? 'text-red-400' : 'text-gray-600';
  const textColor = line.type === 'ctx' ? 'text-slate-400' : 'text-slate-300';

  return (
    <div className="flex" style={{ background: bg, borderLeft: `2px solid ${borderColor}` }}>
      <span className="w-10 text-right px-1.5 text-gray-600 select-none text-[11px] shrink-0">
        {line.num}
      </span>
      <span className={`w-4.5 text-center font-bold select-none shrink-0 ${prefixColor}`}>
        {prefix}
      </span>
      <span className={`flex-1 pr-3.5 whitespace-pre ${textColor}`}>
        {line.text}
      </span>
    </div>
  );
}

function HunkSeparator() {
  return (
    <div className="flex items-center bg-[#1a1a2e] border-y border-[#2a2a2a]">
      <span className="w-10 text-right px-1.5 text-indigo-500 select-none text-[11px] shrink-0">···</span>
      <span className="flex-1 text-[11px] text-indigo-400/60 font-mono pl-2 select-none py-1">
        collapsed lines
      </span>
    </div>
  );
}

function DiffView({ diff }: { diff: DiffPreview }) {
  const hunks = diff.hunks || [];
  const allLines = hunks.flatMap(h => h.lines);
  const added = allLines.filter(l => l.type === 'add').length;
  const removed = allLines.filter(l => l.type === 'del').length;
  const displayPath = diff.file_path.replace(/^\/workspace\/codebase\//, '');

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-[#2a2a2a] bg-[#161616]">
      {/* File header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#1c1c1c] border-b border-[#2a2a2a]">
        <span className="text-xs font-semibold font-mono text-[#e2e8f0] truncate mr-3">{displayPath}</span>
        <div className="flex gap-2.5 text-[11px] font-mono shrink-0">
          <span className="text-green-400">+{added}</span>
          <span className="text-red-400">-{removed}</span>
        </div>
      </div>
      {/* Scrollable hunk container */}
      <div className="max-h-96 overflow-y-auto text-xs leading-[21px] font-mono">
        {hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {hunkIdx > 0 && <HunkSeparator />}
            {hunk.lines.map((line, i) => (
              <DiffLineRow key={`${hunkIdx}-${i}`} line={line} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Approval Buttons ──────────────────────────────────────────── */

function ApprovalButtons({ onApprove, onReject }: { onApprove: () => void; onReject: () => void }) {
  return (
    <div className="flex gap-2 mt-1">
      <button
        onClick={onApprove}
        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-green-900 border border-green-500 text-green-200 hover:bg-green-800 transition"
      >
        Approve
      </button>
      <button
        onClick={onReject}
        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 border border-red-900 text-red-400 hover:bg-red-950 transition"
      >
        Reject
      </button>
    </div>
  );
}

/* ── Thinking Dots ─────────────────────────────────────────────── */

function ThinkingDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const iv = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(iv);
  }, []);
  return <span className="text-blue-400">Thinking{dots}</span>;
}

/* ── Chat Input ────────────────────────────────────────────────── */

function ChatInput({ input, onChange, onKeyDown, onSend, disabled }: {
  input: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-surface border border-border rounded-2xl px-4 py-3">
      <textarea
        value={input}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? 'Waiting for agent...' : 'What UI tweak do you want to implement?'}
        disabled={disabled}
        rows={1}
        className="flex-1 bg-transparent text-foreground placeholder-muted outline-none resize-none text-sm disabled:opacity-50"
      />
      {input.trim() && (
        <button
          onClick={onSend}
          disabled={disabled}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
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

/* ── Main Chat Interface ───────────────────────────────────────── */

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = state.chatMessages ?? [];
  const phase = state.phase ?? 'idle';
  const isProcessing = ['planning', 'executing', 'saving'].includes(phase);
  const isDisabled = isProcessing;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || isDisabled) return;
    sendChatMessage(projectId, text);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const greeting = getGreeting();
  const displayName = username || 'there';

  return (
    <div className="fixed inset-0 z-50 bg-header flex flex-col">
      {/* Header with exit button and status */}
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

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-6 pt-0">
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
                  disabled={isDisabled}
                />
              </div>
            </>
          ) : (
            <div className="w-full space-y-5 self-start pt-0 pb-4">
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl px-4 py-3 text-sm bg-blue-600 text-white">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                if (msg.type === 'diff' && msg.diff) {
                  return (
                    <div key={msg.id} className="pl-7">
                      <DiffView diff={msg.diff} />
                      {msg.diff.status === 'pending' ? (
                        <ApprovalButtons
                          onApprove={() => respondToDiff(projectId, msg.diff!.diff_id, true)}
                          onReject={() => respondToDiff(projectId, msg.diff!.diff_id, false)}
                        />
                      ) : (
                        <span className={`text-xs font-semibold ${msg.diff.status === 'approved' ? 'text-green-400' : 'text-red-400'}`}>
                          {msg.diff.status === 'approved' ? 'Approved' : 'Rejected'}
                        </span>
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

                // Default text message from agent
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="pl-7">
                      <div className="flex items-center gap-2 mb-1.5">
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.0672 2C9.6678 2 7.72266 3.94514 7.72266 6.34459C7.72266 8.74404 9.6678 10.6892 12.0672 10.6892C14.4667 10.6892 16.4118 8.74404 16.4118 6.34459C16.4118 3.94514 14.4667 2 12.0672 2Z" fill="currentColor"/><path d="M20.25 19.453C20.2421 19.8615 19.9087 20.1895 19.5001 20.1895H4.50013C4.09157 20.1895 3.75818 19.8624 3.75027 19.454L3.75023 19.452L3.75019 19.4493L3.7501 19.4423L3.75 19.4211C3.74999 19.404 3.75015 19.3807 3.75072 19.3516C3.75187 19.2937 3.75468 19.2127 3.76117 19.1119C3.77413 18.9107 3.80189 18.6292 3.86099 18.2937C3.97867 17.6258 4.22374 16.7262 4.73808 15.8194C5.79641 13.9537 7.92408 12.1895 12.0001 12.1895C16.0762 12.1895 18.2038 13.9537 19.2622 15.8194C19.7765 16.7262 20.0216 17.6258 20.1393 18.2937C20.1984 18.6292 20.2261 18.9107 20.2391 19.1119C20.2456 19.2127 20.2484 19.2937 20.2495 19.3516C20.2501 19.3807 20.2503 19.404 20.2503 19.4211L20.2502 19.4423L20.2501 19.4493L20.25 19.452L20.25 19.453Z" fill="currentColor"/></svg>
                        <span className="text-xs font-semibold text-indigo-400">Styler</span>
                      </div>
                      <div className="text-sm text-foreground leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Thinking indicator */}
              {isProcessing && (
                <div className="pl-7">
                  <div className="flex items-center gap-2 mb-1.5">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.0672 2C9.6678 2 7.72266 3.94514 7.72266 6.34459C7.72266 8.74404 9.6678 10.6892 12.0672 10.6892C14.4667 10.6892 16.4118 8.74404 16.4118 6.34459C16.4118 3.94514 14.4667 2 12.0672 2Z" fill="currentColor"/><path d="M20.25 19.453C20.2421 19.8615 19.9087 20.1895 19.5001 20.1895H4.50013C4.09157 20.1895 3.75818 19.8624 3.75027 19.454L3.75023 19.452L3.75019 19.4493L3.7501 19.4423L3.75 19.4211C3.74999 19.404 3.75015 19.3807 3.75072 19.3516C3.75187 19.2937 3.75468 19.2127 3.76117 19.1119C3.77413 18.9107 3.80189 18.6292 3.86099 18.2937C3.97867 17.6258 4.22374 16.7262 4.73808 15.8194C5.79641 13.9537 7.92408 12.1895 12.0001 12.1895C16.0762 12.1895 18.2038 13.9537 19.2622 15.8194C19.7765 16.7262 20.0216 17.6258 20.1393 18.2937C20.1984 18.6292 20.2261 18.9107 20.2391 19.1119C20.2456 19.2127 20.2484 19.2937 20.2495 19.3516C20.2501 19.3807 20.2503 19.404 20.2503 19.4211L20.2502 19.4423L20.2501 19.4493L20.25 19.452L20.25 19.453Z" fill="currentColor"/></svg>
                    <span className="text-xs font-semibold text-indigo-400">Styler</span>
                  </div>
                  <ThinkingDots />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input pinned to bottom when messages exist */}
      {messages.length > 0 && (
        <div className="px-6 pb-6 pt-2 max-w-3xl mx-auto w-full">
          <ChatInput
            input={input}
            onChange={setInput}
            onKeyDown={handleKeyDown}
            onSend={handleSend}
            disabled={isDisabled || phase === 'waiting_diff'}
          />
        </div>
      )}
    </div>
  );
}
