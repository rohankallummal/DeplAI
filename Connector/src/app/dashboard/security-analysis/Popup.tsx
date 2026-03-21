'use client';

import { useState, useEffect, useRef } from 'react';
import Stepper, { Step, useStepper } from './Stepper';
import type { RemediationResult } from '@/lib/scan-context';

type PopupScenario = 'clean' | 'github_remediated' | 'local_remediated' | 'failed';

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
  remediationResult?: RemediationResult | null;
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

function RocketIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.6216 4.04316C20.5821 3.69619 20.3083 3.4224 19.9614 3.38283C16.2551 2.96017 12.3947 4.17038 9.55023 7.01484C8.88176 7.6833 8.30341 8.40811 7.81526 9.174L7.81222 9.17412C7.73555 9.29444 7.6611 9.41579 7.58888 9.53809C6.86872 10.7576 6.37031 12.0714 6.09345 13.4211C6.0428 13.668 6.11958 13.9239 6.29782 14.1021L9.89702 17.7013C10.0752 17.8795 10.3311 17.9563 10.578 17.9057C11.9273 17.6291 13.2409 17.1311 14.4602 16.4114C15.3628 15.8787 16.2129 15.225 16.987 14.4509L16.9887 14.4525C19.8326 11.6087 21.0435 7.74873 20.6216 4.04316ZM16.0256 7.9789C16.9258 8.87906 16.9258 10.3385 16.0256 11.2387C15.1255 12.1388 13.666 12.1388 12.7659 11.2387C11.8657 10.3385 11.8657 8.87906 12.7659 7.9789C13.666 7.07874 15.1255 7.07874 16.0256 7.9789Z" fill="currentColor"/>
      <path d="M14.6579 17.4504C13.4302 18.1321 12.1206 18.6103 10.7788 18.8853C10.5634 18.9295 10.3452 18.9321 10.1346 18.8963C10.256 19.6277 10.2443 20.3772 10.0992 21.1059C10.0429 21.3884 10.1534 21.6782 10.3836 21.8515C10.6137 22.0248 10.9228 22.0509 11.1788 21.9188C11.7836 21.6065 12.3505 21.1972 12.856 20.6917C13.7817 19.766 14.3823 18.6383 14.6579 17.4504Z" fill="currentColor"/>
      <path d="M5.10306 13.866C5.06703 13.6549 5.06956 13.4361 5.11385 13.2201C5.38883 11.8796 5.86653 10.5713 6.54731 9.34479C5.36096 9.62075 4.23474 10.2211 3.31006 11.1457C2.80493 11.6509 2.39581 12.2173 2.08364 12.8217C1.95144 13.0776 1.97753 13.3867 2.15076 13.6169C2.324 13.847 2.61377 13.9577 2.89631 13.9015C3.62408 13.7567 4.37256 13.7449 5.10306 13.866Z" fill="currentColor"/>
      <path d="M3.03001 20.25C3.04425 20.6429 3.35947 20.9583 3.75235 20.9725L3.75361 20.9726L3.75565 20.9727L3.76203 20.9729L3.78367 20.9735C3.79965 20.9739 3.82143 20.9744 3.8484 20.9749L3.86028 20.9751C3.92523 20.9761 4.01715 20.9767 4.12879 20.9755C4.35089 20.9731 4.65671 20.9631 4.9863 20.9323C5.31222 20.9019 5.68221 20.8492 6.02513 20.7549C6.34629 20.6666 6.74723 20.5151 7.03929 20.223C7.93945 19.3229 7.93945 17.8634 7.03929 16.9633C6.13913 16.0631 4.67969 16.0631 3.77953 16.9633C3.48747 17.2553 3.33595 17.6563 3.24764 17.9774C3.15335 18.3204 3.10068 18.6903 3.07022 19.0163C3.03942 19.3459 3.02946 19.6517 3.02704 19.8738C3.02582 19.9854 3.02649 20.0773 3.0275 20.1423C3.028 20.1748 3.02859 20.2006 3.02907 20.2189L3.0297 20.2405L3.0299 20.2469L3.03001 20.25Z" fill="currentColor"/>
    </svg>
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

function DeployStep({ onComplete, publishUrl }: { onComplete: () => void; publishUrl?: string | null }) {
  const { next } = useStepper();
  return (
    <div className="flex flex-col items-center text-center">
      {publishUrl && (
        <a
          href={publishUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted hover:text-foreground underline mb-4 transition"
        >
          View on GitHub
        </a>
      )}
      <p className="text-lg text-foreground font-medium mb-10">
        You&apos;re all set to proceed with deployment
      </p>
      <IconButton onClick={() => { next(); onComplete(); }} label="Deploy">
        <RocketIcon />
      </IconButton>
    </div>
  );
}

function CleanContent({ projectName, onClose }: { projectName: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <h2 className="text-2xl font-bold text-foreground mb-3 whitespace-nowrap">
        No vulnerabilities detected in &ldquo;{projectName}&rdquo;
      </h2>
      <p className="text-muted text-base mb-10">
        You&apos;re all set to proceed with deployment
      </p>
      <IconButton onClick={onClose} label="Deploy">
        <RocketIcon />
      </IconButton>
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

function PublishStep({ config, onPublished }: { config: PublishStepConfig; onPublished: (url: string) => void }) {
  const { next } = useStepper();
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

      if (data.url) onPublished(data.url);
      next();
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

function RemediatedContent({ project, onClose, isGitHub }: { project: ProjectInfo | null; onClose: () => void; isGitHub: boolean }) {
  const [publishUrl, setPublishUrl] = useState<string | null>(null);

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

  return (
    <Stepper onComplete={onClose}>
      <Step>
        <PublishStep config={config} onPublished={setPublishUrl} />
      </Step>
      <Step>
        <DeployStep onComplete={onClose} publishUrl={publishUrl} />
      </Step>
    </Stepper>
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

export default function SecurityPopup({ scenario, projectName, project, onClose, remediationResult }: SecurityPopupProps) {
  return (
    <div className="relative w-full max-w-[680px] mx-4 rounded-2xl shadow-2xl overflow-hidden bg-surface border border-border">
      <div className="px-10 py-12">
        {scenario === 'failed' && <CloseButton onClick={onClose} />}

        {scenario === 'clean' && (
          <CleanContent projectName={projectName} onClose={onClose} />
        )}
        {(scenario === 'github_remediated' || scenario === 'local_remediated') && (
          <RemediatedContent project={project} onClose={onClose} isGitHub={scenario === 'github_remediated'} />
        )}
        {scenario === 'failed' && (
          <FailedContent onClose={onClose} remediationResult={remediationResult} />
        )}
      </div>
    </div>
  );
}
