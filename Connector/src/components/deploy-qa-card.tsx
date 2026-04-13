'use client';

import { useState, useEffect, useRef } from 'react';
import { FiArrowUp } from 'react-icons/fi';
import type { ClarificationQuestion } from '@/lib/deploy-context';

interface DeployQACardProps {
  projectId: string;
  questions: ClarificationQuestion[];
  currentQuestionIndex: number;
  onSendAnswer: (projectId: string, questionId: string, answer: string) => void;
  onSubmitAll: (projectId: string) => void;
}

type DismissPhase = 'active' | 'dismissing' | 'card-out' | 'generate-in' | 'ready';

export default function DeployQACard({
  projectId,
  questions,
  currentQuestionIndex,
  onSendAnswer,
  onSubmitAll,
}: DeployQACardProps) {
  const [inputValue, setInputValue] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [dismissPhase, setDismissPhase] = useState<DismissPhase>('active');
  const [generateVisible, setGenerateVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuestionRef = useRef<ClarificationQuestion | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const allAnswered = questions.length > 0 && currentQuestionIndex >= questions.length;
  const currentQuestion = questions[currentQuestionIndex];

  useEffect(() => {
    if (currentQuestion) {
      lastQuestionRef.current = currentQuestion;
    }
  }, [currentQuestion]);

  useEffect(() => {
    setShowCustomInput(false);
    setInputValue('');
  }, [currentQuestionIndex]);

  useEffect(() => {
    if (showCustomInput) {
      inputRef.current?.focus();
    }
  }, [showCustomInput]);

  useEffect(() => {
    if (dismissPhase === 'generate-in') {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setGenerateVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [dismissPhase]);

  useEffect(() => {
    if (allAnswered && dismissPhase === 'active') {
      setDismissPhase('dismissing');

      const optionCount = lastQuestionRef.current?.options?.length || 0;
      const totalElements = 1 + 1 + optionCount + 1;
      const stagger = 100;
      const transition = 300;
      const contentDismissTime = totalElements * stagger + transition;
      const cardOutDuration = 400;

      const t1 = setTimeout(() => setDismissPhase('card-out'), contentDismissTime);
      const t2 = setTimeout(() => setDismissPhase('generate-in'), contentDismissTime + cardOutDuration);
      const t3 = setTimeout(() => setDismissPhase('ready'), contentDismissTime + cardOutDuration + 1100);
      timersRef.current = [t1, t2, t3];
    }

    return () => timersRef.current.forEach(clearTimeout);
  }, [allAnswered]);

  const handleOptionClick = (option: string) => {
    if (!currentQuestion) return;
    onSendAnswer(projectId, currentQuestion.id, option);
  };

  const handleCustomSend = () => {
    if (!inputValue.trim() || !currentQuestion) return;
    onSendAnswer(projectId, currentQuestion.id, inputValue.trim());
    setInputValue('');
    setShowCustomInput(false);
  };

  const handleSkip = () => {
    if (!currentQuestion) return;
    onSendAnswer(projectId, currentQuestion.id, 'Skipped');
  };

  const displayQuestion = currentQuestion || lastQuestionRef.current;
  if (!displayQuestion && dismissPhase === 'active') return null;

  const options = displayQuestion?.options || [];
  const isDismissing = dismissPhase === 'dismissing' || dismissPhase === 'card-out';
  const isCardOut = dismissPhase === 'card-out';

  const stagger = 100;
  const customInputDelay = 0;
  const dividerDelay = 1 * stagger;
  const getOptionDelay = (i: number) => (2 + (options.length - 1 - i)) * stagger;
  const questionDelay = (2 + options.length) * stagger;

  const dismissStyle = (delay: number): React.CSSProperties => ({
    opacity: isDismissing ? 0 : 1,
    transform: isDismissing ? 'translateY(10px)' : 'none',
    transition: 'opacity 300ms ease, transform 300ms ease',
    transitionDelay: isDismissing ? `${delay}ms` : '0ms',
  });

  if (dismissPhase === 'generate-in' || dismissPhase === 'ready') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-140px)]">
        <div
          className="w-full max-w-xl"
          style={{
            opacity: generateVisible ? 1 : 0,
            transform: generateVisible ? 'none' : 'translateY(10px)',
            transition: 'opacity 400ms ease, transform 400ms ease',
          }}
        >
          <div className="bg-[#333132] dark:bg-[#C9C8C7] border border-[#444243] dark:border-[#b5b4b3] rounded-3xl overflow-hidden shadow-2xl">
            <div
              className="px-14 pt-14 pb-8"
              style={{
                opacity: generateVisible ? 1 : 0,
                transform: generateVisible ? 'none' : 'translateY(8px)',
                transition: 'opacity 300ms ease 400ms, transform 300ms ease 400ms',
              }}
            >
              <h3 className="text-2xl font-medium text-white dark:text-black leading-relaxed text-center">
                Questions completed, let&apos;s move on.
              </h3>
            </div>

            <div
              className="px-6 pb-6"
              style={{
                opacity: generateVisible ? 1 : 0,
                transform: generateVisible ? 'none' : 'translateY(10px)',
                transition: 'opacity 300ms ease 700ms, transform 300ms ease 700ms',
              }}
            >
              <div className="px-8 py-6">
                <button
                  onClick={() => onSubmitAll(projectId)}
                  className="mx-auto block px-12 py-4 rounded-xl bg-[#F1F1F1] dark:bg-[#1b1b1b] text-black dark:text-white text-lg font-semibold hover:bg-[#e4e4e4] dark:hover:bg-[#2a2a2a] transition-colors"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-[calc(100vh-140px)]">
      <div
        className="w-full max-w-6xl"
        style={{
          opacity: isCardOut ? 0 : 1,
          transform: isCardOut ? 'translateY(10px)' : 'none',
          transition: 'opacity 400ms ease, transform 400ms ease',
        }}
      >
        <div className="bg-[#333132] dark:bg-[#C9C8C7] border border-[#444243] dark:border-[#b5b4b3] rounded-2xl overflow-hidden shadow-2xl">
          <div className="px-14 pt-14 pb-8" style={isDismissing ? dismissStyle(questionDelay) : undefined}>
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-2xl font-medium text-white dark:text-black leading-relaxed flex-1">
                {displayQuestion?.question}
              </h3>
            </div>
          </div>

          <div className="px-6 pb-6">
            {options.map((option, i) => (
              <div key={option} style={isDismissing ? dismissStyle(getOptionDelay(i)) : undefined}>
                <button
                  onClick={!isDismissing ? () => handleOptionClick(option) : undefined}
                  disabled={isDismissing}
                  className="group w-full flex items-center gap-5 px-8 py-6 rounded-xl text-left transition-colors hover:bg-[#3e3d3d] dark:hover:bg-[#bdbcbb] focus:bg-[#3e3d3d] dark:focus:bg-[#bdbcbb] focus:outline-none disabled:pointer-events-none"
                >
                  <span className="w-9 h-9 rounded-full bg-[#2a2829] dark:bg-[#bdbcbb] border border-[#222021] dark:border-[#a8a7a6] flex items-center justify-center text-sm font-medium text-white/60 dark:text-black/60 shrink-0 group-hover:border-white/40 dark:group-hover:border-black/30 group-hover:text-white dark:group-hover:text-black transition-colors">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-lg text-white/70 dark:text-black/60 group-hover:text-white dark:group-hover:text-neutral-800 transition-colors">
                    {option}
                  </span>
                  <svg
                    className="w-4 h-4 text-white/30 dark:text-black/30 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            ))}

            {options.length > 0 && (
              <div style={isDismissing ? dismissStyle(dividerDelay) : undefined}>
                <div className="mx-8 my-3 border-t border-[#444243] dark:border-[#b5b4b3]" />
              </div>
            )}

            <div style={isDismissing ? dismissStyle(customInputDelay) : undefined}>
              {!showCustomInput ? (
                <button
                  onClick={!isDismissing ? () => setShowCustomInput(true) : undefined}
                  disabled={isDismissing}
                  className="group w-full flex items-center gap-5 px-8 py-6 rounded-xl text-left transition-colors hover:bg-[#3e3d3d] dark:hover:bg-[#bdbcbb] focus:bg-[#3e3d3d] dark:focus:bg-[#bdbcbb] focus:outline-none disabled:pointer-events-none"
                >
                  <span className="w-9 h-9 rounded-full bg-[#2a2829] dark:bg-[#bdbcbb] border border-[#222021] dark:border-[#a8a7a6] flex items-center justify-center shrink-0 group-hover:border-neutral-500 dark:group-hover:border-black/30 transition-colors">
                    <svg className="w-3.5 h-3.5 text-white/50 dark:text-black/50 group-hover:text-white dark:group-hover:text-black transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </span>
                  <span className="flex-1 text-lg text-white/50 dark:text-black/50 group-hover:text-white/80 dark:group-hover:text-black transition-colors">
                    Something else
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isDismissing) handleSkip();
                    }}
                    className="text-xs text-white/40 dark:text-black/50 hover:text-white/70 dark:hover:text-black/70 transition-colors px-2 py-1 rounded-md hover:bg-[#2a2829] dark:hover:bg-[#bdbcbb]"
                  >
                    Skip
                  </span>
                </button>
              ) : (
                <div className="px-8 py-6">
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCustomSend();
                        if (e.key === 'Escape') {
                          setShowCustomInput(false);
                          setInputValue('');
                        }
                      }}
                      placeholder="Type your answer"
                      className="w-full px-4 py-3 pr-12 rounded-xl bg-[#2a2829] dark:bg-[#bdbcbb] border border-[#222021] dark:border-[#a8a7a6] text-base text-white dark:text-black placeholder-white/40 dark:placeholder-black/40 focus:outline-none focus:border-white/40 dark:focus:border-black/30 transition"
                    />
                    <button
                      onClick={handleCustomSend}
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-[#F1F1F1] dark:bg-[#1b1b1b] text-black dark:text-white hover:bg-[#e4e4e4] dark:hover:bg-[#2a2a2a] transition-all duration-200 ${inputValue.trim() ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}`}
                    >
                      <FiArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
