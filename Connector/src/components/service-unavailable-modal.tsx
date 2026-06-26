'use client';

import Lottie from 'lottie-react';
import alertAnimation from '@/components/animation/alert.json';

interface ServiceUnavailableModalProps {
  open: boolean;
  onAcknowledge: () => void;
}

export default function ServiceUnavailableModal({ open, onAcknowledge }: ServiceUnavailableModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_150ms_ease-out]">
      {/* Backdrop blurs the app behind the modal. No onClick — only OK dismisses,
          so the modal blocks all further interaction. */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="service-unavailable-title"
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl bg-surface border border-border animate-[scaleIn_200ms_ease-out]"
      >
        <div className="px-8 py-10 flex flex-col items-center text-center">
          <div className="w-28 h-28 mb-4">
            <Lottie animationData={alertAnimation} loop />
          </div>
          <h2 id="service-unavailable-title" className="text-2xl font-bold text-foreground mb-3">
            Services Unavailable
          </h2>
          <p className="text-muted text-base mb-8">
            Backend services are currently unavailable. Please try again later.
          </p>
          <button
            onClick={onAcknowledge}
            className="py-3 px-10 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition cursor-pointer"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
