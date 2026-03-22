'use client';

import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

function ChatInput({ input, onChange, onKeyDown, onSend }: {
  input: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-surface border border-border rounded-2xl px-4 py-3">
      <textarea
        value={input}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="How may I help you?"
        rows={1}
        className="flex-1 bg-transparent text-foreground placeholder-muted outline-none resize-none text-sm"
      />
      <button
        onClick={onSend}
        disabled={!input.trim()}
        className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

export default function ChatInterface({ username }: { username: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto py-8">
        <div className="flex flex-col items-center justify-center h-full max-w-3xl mx-auto">
          {messages.length === 0 ? (
            <>
              <h1 className="text-3xl font-semibold text-foreground mb-8">
                Good {greeting}, {displayName}
              </h1>
              <div className="w-full">
                <ChatInput input={input} onChange={setInput} onKeyDown={handleKeyDown} onSend={handleSend} />
              </div>
            </>
          ) : (
            <div className="w-full space-y-6 self-start">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-surface border border-border text-foreground'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
              <div className="w-full sticky bottom-0 pb-4">
                <ChatInput input={input} onChange={setInput} onKeyDown={handleKeyDown} onSend={handleSend} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
