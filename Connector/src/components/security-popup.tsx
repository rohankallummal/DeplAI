'use client';

import { useState, useEffect, useRef } from 'react';
import Lottie from 'lottie-react';
import tickAnimation from '@/components/animation/tick.json';
import type { RemediationResult } from '@/lib/scan-context';

type PopupScenario = 'clean' | 'github_remediated' | 'local_remediated' | 'failed' | 'published';

export interface ProjectInfo {
  id: string;
  name: string;
  type: string;
  owner?: string;
  repo?: string;
  installationId?: string;
}

interface SecurityPopupProps {
  scenario: PopupScenario;
  projectName: string;
  project: ProjectInfo | null;
  onClose: () => void;
  onPublishComplete?: (url: string) => void;
  remediationResult?: RemediationResult | null;
  publishedUrl?: string | null;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-5 right-5 p-2 text-muted hover:text-foreground hover:bg-surface-hover rounded-lg transition"
      title="Close"
      aria-label="Close"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
  );
}

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 py-3 px-8 bg-surface-hover hover:bg-border text-foreground font-semibold rounded-xl transition border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function IconButton({ onClick, disabled, children, label }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center p-3 bg-surface-hover hover:bg-border text-foreground rounded-xl transition border border-border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-6 w-6 text-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function PullRequestIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M6 9v12" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 1.27a11 11 0 00-3.48 21.46c.55.09.73-.28.73-.55v-1.84c-3.03.64-3.67-1.46-3.67-1.46-.55-1.29-1.28-1.65-1.28-1.65-.92-.65.1-.65.1-.65 1.1 0 1.73 1.1 1.73 1.1.92 1.65 2.57 1.2 3.21.92a2.16 2.16 0 01.64-1.47c-2.47-.27-5.04-1.19-5.04-5.5 0-1.1.46-2.1 1.2-2.84a3.76 3.76 0 010-2.93s.91-.28 3.11 1.1c1.8-.49 3.7-.49 5.5 0 2.1-1.38 3.02-1.1 3.02-1.1a3.76 3.76 0 010 2.93c.74.74 1.2 1.74 1.2 2.84 0 4.31-2.58 5.23-5.06 5.5.45.37.82.92.82 2.02v3.03c0 .27.18.64.73.55A11 11 0 0012 1.27" />
    </svg>
  );
}

function CleanContent({ projectName, onClose }: { projectName: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <h2 className="text-2xl font-bold text-foreground mb-3 whitespace-nowrap">
        No vulnerabilities detected in &ldquo;{projectName}&rdquo;
      </h2>
      <p className="text-muted text-base mb-10">
        Your codebase is clean — no issues found.
      </p>
      <ActionButton onClick={onClose}>Back to Dashboard</ActionButton>
    </div>
  );
}

interface PublishStepConfig {
  endpoint: string;
  body: Record<string, unknown>;
  description: string;
  errorLabel: string;
  icon: React.ReactNode;
  buttonLabel: string;
}

function openAuthPopup() {
  const w = 500, h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  return window.open(
    '/api/auth/publish-login',
    'deplai-github-auth',
    `width=${w},height=${h},left=${left},top=${top}`,
  );
}

function PublishStep({ config, onComplete }: { config: PublishStepConfig; onComplete: (url: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doPublishRef = useRef<() => Promise<void>>(null!);

  async function doPublish() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.body),
      });

      const data = await res.json();

      if (res.status === 401) {
        const popup = openAuthPopup();
        if (!popup || popup.closed) {
          setError('Popup was blocked. Please allow popups for this site.');
        }
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || config.errorLabel);
        return;
      }

      onComplete(data.url || '');
    } catch {
      setError(config.errorLabel);
    } finally {
      setLoading(false);
    }
  }

  doPublishRef.current = doPublish;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'publish-auth') return;

      if (event.data.success) {
        doPublishRef.current();
      } else {
        setError(event.data.error || 'GitHub authorization failed');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-2xl font-bold text-foreground mb-3">
        Issues in the codebase are resolved
      </h2>
      <p className="text-muted text-base mb-10">{config.description}</p>
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <IconButton onClick={doPublish} disabled={loading} label={config.buttonLabel}>
        {loading ? <Spinner /> : config.icon}
      </IconButton>
    </div>
  );
}

function RemediatedContent({ project, onPublishComplete, isGitHub }: { project: ProjectInfo | null; onPublishComplete: (url: string) => void; isGitHub: boolean }) {
  const config: PublishStepConfig | null = project ? (isGitHub ? {
    endpoint: '/api/publish/create-pr',
    body: { project_id: project.id, owner: project.owner, repo: project.repo },
    description: 'Update the changes to GitHub',
    errorLabel: 'Failed to create pull request',
    icon: <PullRequestIcon />,
    buttonLabel: 'Create PR',
  } : {
    endpoint: '/api/publish/create-repo',
    body: { project_id: project.id, project_name: project.name },
    description: 'Create a GitHub repository to save and manage the updated code',
    errorLabel: 'Failed to create repository',
    icon: <GitHubIcon />,
    buttonLabel: 'Create GitHub Repository',
  }) : null;

  if (!config) return null;

  return <PublishStep config={config} onComplete={onPublishComplete} />;
}

function PublishedContent({ publishedUrl, onClose, isGitHub }: { publishedUrl: string; onClose: () => void; isGitHub: boolean }) {
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <div className="w-32 h-32 mb-6 scale-200">
        <Lottie animationData={tickAnimation} loop={false} />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-3">
        Remediation Complete
      </h2>
      <p className="text-muted text-base mb-6">
        {isGitHub
          ? 'A pull request has been created with the fixes.'
          : 'A GitHub repository has been created with the updated code.'}
      </p>
      {publishedUrl && (
        <a
          href={publishedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium hover:underline mb-2 transition"
        >
          View on GitHub
        </a>
      )}
    </div>
  );
}

function FailedContent({ onClose, remediationResult }: { onClose: () => void; remediationResult?: RemediationResult | null }) {
  return (
    <div className="flex flex-col items-center text-center pt-4">
      <div className="w-16 h-16 mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 9V13M12 17H12.01M12 3L2 21H22L12 3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-foreground mb-3">
        The vulnerabilities could not be resolved
      </h2>
      {remediationResult?.message && (
        <p className="text-muted text-base mb-2">
          {remediationResult.message}
        </p>
      )}
      {remediationResult?.cycles_run ? (
        <p className="text-muted text-sm mb-8">
          {remediationResult.cycles_run} remediation cycle{remediationResult.cycles_run > 1 ? 's' : ''} attempted
        </p>
      ) : <div className="mb-8" />}
      <ActionButton onClick={onClose}>Close</ActionButton>
    </div>
  );
}

export default function SecurityPopup({ scenario, projectName, project, onClose, onPublishComplete, remediationResult, publishedUrl }: SecurityPopupProps) {
  return (
    <div className="relative w-full max-w-[680px] mx-4 rounded-2xl shadow-2xl overflow-hidden bg-surface border border-border">
      <div className="px-10 py-12">
        {(scenario === 'failed' || scenario === 'published') && <CloseButton onClick={onClose} />}

        {scenario === 'clean' && (
          <CleanContent projectName={projectName} onClose={onClose} />
        )}
        {(scenario === 'github_remediated' || scenario === 'local_remediated') && onPublishComplete && (
          <RemediatedContent
            project={project}
            onPublishComplete={onPublishComplete}
            isGitHub={scenario === 'github_remediated'}
          />
        )}
        {scenario === 'published' && publishedUrl != null && (
          <PublishedContent
            publishedUrl={publishedUrl}
            onClose={onClose}
            isGitHub={project?.type !== 'local'}
          />
        )}
        {scenario === 'failed' && (
          <FailedContent onClose={onClose} remediationResult={remediationResult} />
        )}
      </div>
    </div>
  );
}
