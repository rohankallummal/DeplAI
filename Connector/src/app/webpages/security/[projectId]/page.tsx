'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { LoadingScreen } from '@/components/loading-spinner';
import { ExitIcon } from '@/components/log-in-out';
import ThemeToggle from '@/components/theme-toggle';
import RemediationRequest from '@/components/remediation-request';

import Findings from '../findings';
import { useScan } from '@/lib/scan-context';
import Monitor from '../monitor';
import SecurityPopup, { type ProjectInfo } from '@/components/security-popup';

export default function SecurityAnalysisPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;

  const { resetAll, getScanState, startRemediation, getRemediationState, getRemediationResult, isAnyRemediating, restoreState } = useScan();
  const { state: scanState, projectName: scanProjectName } = getScanState(projectId);
  const { state: remediationState } = getRemediationState(projectId);
  const remediationResult = getRemediationResult(projectId);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePopup, setActivePopup] = useState<'clean' | 'remediated' | 'failed' | 'published' | null>(null);
  const [findingsReady, setFindingsReady] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [createdFromLocal, setCreatedFromLocal] = useState(false);

  const remediating = remediationState === 'running';
  const remediationDone = remediationState === 'completed';

  useEffect(() => {
    fetchProjectInfo();
    restoreState(projectId);

    const stored = localStorage.getItem(`deplai_published_${projectId}`);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setPublishedUrl(data.url || '');
        setActivePopup('published');
      } catch {}
    }
  }, [projectId]);

  useEffect(() => {
    if (scanState === 'running') {
      setFindingsReady(false);
    }
  }, [scanState]);

  useEffect(() => {
    if (remediationDone && remediationResult) {
      if (remediationResult.success) {
        localStorage.setItem(`deplai_remediated_${projectId}`, 'true');
      }
      setActivePopup(prev =>
        prev === 'published' ? prev : remediationResult.success ? 'remediated' : 'failed'
      );
    }
  }, [remediationDone, remediationResult, projectId]);

  useEffect(() => {
    if (!project || project.type === 'local') return;
    if (activePopup === 'published' && publishedUrl) return;

    const fullName = `${project.owner}/${project.repo}`;
    try {
      const created = JSON.parse(localStorage.getItem('deplai_created_repos') || '[]');
      const match = created.find((r: any) => r.fullName === fullName);
      if (match) {
        setPublishedUrl(match.url);
        setCreatedFromLocal(true);
        setActivePopup('published');
      }
    } catch {}
  }, [project]);

  async function fetchProjectInfo() {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    resetAll();
    localStorage.removeItem('theme');
    localStorage.removeItem('deplai_created_repos');
    Object.keys(localStorage)
      .filter(k => k.startsWith('deplai_published_') || k.startsWith('deplai_remediated_'))
      .forEach(k => localStorage.removeItem(k));
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  const handleFindingsReady = useCallback((ready: boolean) => {
    setFindingsReady(ready);
  }, []);

  const handleCleanScan = useCallback(() => {
    setActivePopup('clean');
  }, []);

  async function handleStartRemediation() {
    await startRemediation(projectId);
  }

  async function handlePublishComplete(url: string) {
    localStorage.setItem(
      `deplai_published_${projectId}`,
      JSON.stringify({ url }),
    );

    if (project?.type === 'local') {
      try {
        const repoFullName = new URL(url).pathname.slice(1).replace(/\/$/, '');
        const existing = JSON.parse(localStorage.getItem('deplai_created_repos') || '[]');
        existing.push({ fullName: repoFullName, url });
        localStorage.setItem('deplai_created_repos', JSON.stringify(existing));
      } catch {}

      try {
        await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      } catch {}
    }

    const name = project?.name || project?.repo || scanProjectName || 'Unknown';
    const isGitHub = project?.type !== 'local';
    localStorage.setItem(
      'deplai_pending_notification',
      JSON.stringify({
        type: 'success',
        message: isGitHub
          ? `Pull request created successfully for "${name}".`
          : `GitHub repository created successfully for "${name}".`,
      }),
    );

    router.push('/webpages');
  }

  const popupScenario = useMemo((): 'clean' | 'failed' | 'published' | 'local_remediated' | 'github_remediated' | null => {
    if (activePopup === 'clean') return 'clean';
    if (activePopup === 'failed') return 'failed';
    if (activePopup === 'published') return 'published';
    if (activePopup === 'remediated') {
      return project?.type === 'local' ? 'local_remediated' : 'github_remediated';
    }
    return null;
  }, [activePopup, project]);

  const popupProject: ProjectInfo | null = project ? {
    id: project.id,
    name: project.name || project.repo || '',
    type: project.type,
    owner: project.owner,
    repo: project.repo,
    installationId: project.installationId,
  } : null;

  const popupActive = popupScenario !== null;

  function handlePopupClose() {
    if (activePopup === 'clean' || activePopup === 'published') {
      router.push('/webpages');
    } else {
      setActivePopup(null);
    }
  }

  if (loading) {
    return <LoadingScreen />;
  }

  const showPencilIcon = findingsReady && scanState !== 'running' && !remediating && !remediationDone && !isAnyRemediating;

  return (
    <div className="h-screen flex flex-col bg-header">
      <header className="bg-header border-b border-border sticky top-0 z-20 shrink-0">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Monitor projectId={projectId} onOpenChange={setMonitorOpen} />
              {showPencilIcon && (
                <button
                  onClick={() => setRemediationOpen(true)}
                  className="p-2 text-muted hover:text-foreground hover:bg-[#fffafa] dark:hover:bg-surface-hover rounded-lg transition"
                  title="Edit"
                  aria-label="Edit"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14.8634 6.09743L17.9019 9.13594M18.7724 4.31043L19.6896 5.22763C20.2754 5.81341 20.2754 6.76316 19.6896 7.34895L9.40256 17.636C9.22846 17.8101 9.01419 17.9387 8.77864 18.0104L4.76953 19.2305L5.9897 15.2214C6.06138 14.9859 6.18995 14.7716 6.36405 14.5975L16.6511 4.31043C17.2369 3.72465 18.1866 3.72465 18.7724 4.31043Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="p-2 text-muted hover:text-foreground rounded-lg transition"
                title="Logout"
              >
                <ExitIcon />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className={`flex-1 min-h-0 flex flex-col container mx-auto px-6 py-4 transition-all duration-200 ${popupActive && !monitorOpen ? 'blur-md pointer-events-none select-none' : ''}`}>
          <div className="flex-1 min-h-0">
            <Findings projectId={projectId} remediating={remediating} remediationDone={remediationDone} onCleanScan={handleCleanScan} onFindingsReady={handleFindingsReady} />
          </div>
        </div>

        {popupActive && !monitorOpen && popupScenario && (
          <div className="absolute inset-0 z-40 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" />
            <SecurityPopup
              scenario={popupScenario}
              projectName={project?.name || project?.repo || scanProjectName || 'Unknown'}
              project={popupProject}
              onClose={handlePopupClose}
              onPublishComplete={handlePublishComplete}
              remediationResult={remediationResult}
              publishedUrl={publishedUrl}
              createdFromLocal={createdFromLocal}
            />
          </div>
        )}
      </div>

      <RemediationRequest
        isOpen={remediationOpen}
        onClose={() => setRemediationOpen(false)}
        onContinue={handleStartRemediation}
      />
    </div>
  );
}
