'use client';

import LoadingSpinner from '@/components/loading-spinner';
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
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 bg-red-100 dark:bg-red-900/30">
            <svg className="w-7 h-7 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
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

  // initializing: preparing / installing / starting / idle
  const recent = state.messages.slice(-4);
  return (
    <div className={`w-full ${PANEL_HEIGHT} flex flex-col items-center justify-center px-6`}>
      <LoadingSpinner size="md" />
      <p className="text-foreground font-medium mt-4">{PHASE_LABEL[state.phase]}</p>
      {recent.length > 0 && (
        <div className="mt-3 space-y-1 text-center">
          {recent.map((m, i) => (
            <p key={i} className="text-sm text-muted">{m}</p>
          ))}
        </div>
      )}
    </div>
  );
}
