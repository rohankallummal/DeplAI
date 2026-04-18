'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { usePageLoading } from '@/lib/page-loading-context';
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

  const { getScanState, startRemediation, getRemediationState, getRemediationResult, isAnyRemediating, restoreState } = useScan();
  const { state: scanState, projectName: scanProjectName } = getScanState(projectId);
  const { state: remediationState } = getRemediationState(projectId);
  const remediationResult = getRemediationResult(projectId);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activePopup, setActivePopup] = useState<'clean' | 'remediated' | 'failed' | 'published' | null>(null);
  const [findingsReady, setFindingsReady] = useState(false);
  const [findingsLoaded, setFindingsLoaded] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [createdFromLocal, setCreatedFromLocal] = useState(false);

  const remediating = remediationState === 'running';
  const remediationDone = remediationState === 'completed';

  usePageLoading(loading || !findingsLoaded);

  useEffect(() => {
    async function init() {
      await Promise.all([fetchProjectInfo(), restoreState(projectId)]);
      setLoading(false);
    }
    init();

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
    }
  }

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

  if (loading) return null;

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
                  <svg width="25" height="25" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.91553 3.5625C5.91553 3.14829 6.25131 2.8125 6.66553 2.8125H14.3364C16.9598 2.8125 19.0864 4.93915 19.0864 7.5625V7.74609C19.0864 8.16031 18.7506 8.49609 18.3364 8.49609H6.66553C6.25131 8.49609 5.91553 8.16031 5.91553 7.74609V3.5625Z" fill="currentColor"/>
                    <path opacity="0.4" d="M10.3347 9.49609L9.82426 20.4578C9.76455 21.7402 10.7881 22.8125 12.0718 22.8125H12.9289C14.2126 22.8125 15.2362 21.7402 15.1764 20.4578L14.666 9.49609H10.3347Z" fill="currentColor"/>
                  </svg>
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 relative">
        <div className={`flex-1 min-h-0 flex flex-col container mx-auto px-6 py-4 transition-all duration-200 ${popupActive && !monitorOpen ? 'blur-md pointer-events-none select-none' : ''}`}>
          <div className="flex-1 min-h-0">
            <Findings projectId={projectId} remediating={remediating} onCleanScan={handleCleanScan} onFindingsReady={setFindingsReady} onLoaded={() => setFindingsLoaded(true)} />
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
