'use client';

import Lottie from 'lottie-react';
import aiAnimation from '@/components/animation/ai.json';

interface RemediationRequestProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
}

export default function RemediationRequest({ isOpen, onClose, onContinue }: RemediationRequestProps) {
  if (!isOpen) return null;

  const handleContinue = () => {
    onContinue();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />

      <div className="relative bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[480px] mx-4 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-muted hover:text-foreground rounded-lg transition z-10"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8 pt-6">
          <div className="flex flex-col items-center">
            <Lottie
              animationData={aiAnimation}
              loop
              className="w-20 h-20 mb-6"
            />

            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3 text-center">
              Remediation
            </h3>

            <p className="text-gray-600 dark:text-gray-400 text-center leading-relaxed mb-8">
              Fix detected security vulnerabilities with Agent417
            </p>

            <button
              onClick={handleContinue}
              className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg transition shadow-sm"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
