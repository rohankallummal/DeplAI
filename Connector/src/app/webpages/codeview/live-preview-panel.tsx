'use client';

import Lottie from 'lottie-react';
import LoadingSpinner from '@/components/loading-spinner';
import alertAnimation from '@/components/animation/alert.json';
import { usePreview, type PreviewPhase } from '@/lib/preview-context';

const PHASE_LABEL: Record<PreviewPhase, string> = {
  idle: 'Initializing',
  preparing: 'Preparing your project',
  installing: 'Installing dependencies',
  starting: 'Starting the development server',
  ready: 'Ready',
  error: 'Something went wrong',
};

// Code View header (top bar only — breadcrumbs are hidden in preview mode).
const PANEL_HEIGHT = 'h-[calc(100vh-73px)]';

export default function LivePreviewPanel({
  projectId,
  onRetry,
  onExit,
}: {
  projectId: string;
  onRetry: () => void;
  onExit: () => void;
}) {
  const { getPreviewState } = usePreview();
  const state = getPreviewState(projectId);

  if (state.phase === 'ready' && state.url) {
    return (
      <div className={`w-full ${PANEL_HEIGHT}`}>
        <iframe
          src={state.url}
          title="Live Preview"
          className="w-full h-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className={`w-full ${PANEL_HEIGHT} flex items-center justify-center px-6`}>
        <div className="max-w-lg w-full text-center">
          <div className="w-28 h-28 mx-auto mb-4">
            <Lottie animationData={alertAnimation} loop />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Preview could not start</h3>
          <p className="text-muted text-sm leading-relaxed whitespace-pre-wrap mb-6">
            {state.error || 'The preview could not be started.'}
          </p>
          <div className="flex items-center justify-center gap-2.5">
            <button
              onClick={onExit}
              className="py-2.5 px-5 text-sm font-medium text-foreground hover:bg-surface-hover rounded-lg border border-border transition"
            >
              Exit Preview
            </button>
            <button
              onClick={onRetry}
              className="py-2.5 px-6 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // initializing: preparing / installing / starting / idle — a single current
  // status line (the phase label already reflects each step).
  return (
    <div className={`w-full ${PANEL_HEIGHT} flex flex-col items-center justify-center px-6`}>
      <LoadingSpinner size="md" />
      <p className="text-foreground font-medium mt-4">{PHASE_LABEL[state.phase]}</p>
    </div>
  );
}
