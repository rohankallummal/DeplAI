'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ExitIcon } from '@/components/log-in-out';
import ThemeToggle from '@/components/theme-toggle';
import Projects from './dashboard/dashboard';
import { usePopup } from '@/components/toast-notification';
import { useScan } from '@/lib/scan-context';
import { useDeploy } from '@/lib/deploy-context';
import { usePageLoading } from '@/lib/page-loading-context';
import type { SessionData } from '@/lib/session';
import type { Project } from '@/lib/types';

export default function Dashboard() {
  const router = useRouter();
  const { showPopup } = usePopup();
  const { startScan, activeScanIds, resetAll, activeRemediationIds } = useScan();
  const { activeDeployIds, activeDeployProjectNames } = useDeploy();
  const [user, setUser] = useState<SessionData['user'] | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [installations, setInstallations] = useState<unknown[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  usePageLoading(authLoading);

  useEffect(() => {
    checkAuth();

    const pending = localStorage.getItem('deplai_pending_notification');
    if (pending) {
      localStorage.removeItem('deplai_pending_notification');
      try {
        const data = JSON.parse(pending);
        showPopup({ type: data.type || 'success', message: data.message });
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; checkAuth/showPopup are stable
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/session');
      const session = await res.json();

      if (!session.isLoggedIn) {
        router.push('/');
        return;
      }

      setUser(session.user);

      await Promise.all([
        fetchInstallations().catch(() => {}),
        fetchProjects().catch(() => {}),
      ]);

      setAuthLoading(false);

      fetch('/api/sync', { method: 'POST' })
        .then(() => {
          fetchInstallations();
          fetchProjects(false);
        })
        .catch(() => {});
    } catch (error) {
      console.error('Auth check failed:', error);
      router.push('/');
    }
  }

  async function fetchInstallations() {
    const res = await fetch('/api/installations');
    const data = await res.json();
    setInstallations(data.installations || []);
  }

  async function fetchProjects(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
    if (showSpinner) setLoading(false);
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      showPopup({ type: 'error', message: 'Please upload a .zip file' });
      return;
    }

    const projectName = prompt('Enter project name:');
    if (!projectName || projectName.trim().length === 0) {
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', projectName.trim());

      const response = await fetch('/api/projects/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        showPopup({ type: 'success', message: `Project "${projectName}" uploaded successfully!` });
        fetchProjects();
      } else {
        showPopup({ type: 'error', message: data.error || 'Failed to upload project' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      showPopup({ type: 'error', message: 'Failed to upload project' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleDeleteProject(projectId: string, projectName: string) {
    const confirmed = confirm(`Delete "${projectName}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (response.ok) {
        showPopup({ type: 'success', message: `Project "${projectName}" deleted successfully` });
        fetchProjects();
      } else {
        showPopup({ type: 'error', message: data.error || 'Failed to delete project' });
      }
    } catch (error) {
      console.error('Delete error:', error);
      showPopup({ type: 'error', message: 'Failed to delete project' });
    }
  }

  function handleProjectClick(project: Project) {
    if (project.type === 'local') {
      router.push(`/webpages/codeview?project_id=${project.id}&type=local`);
    } else {
      router.push(`/webpages/codeview?project_id=${project.id}&owner=${project.owner}&repo=${project.repo}&type=github`);
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

  if (authLoading) return null;

  return (
    <div className="min-h-screen bg-header">
      <header className="bg-header border-b border-border sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {user?.avatarUrl && (
                <a
                  href={`https://github.com/${user.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={user.login}
                >
                  <Image
                    src={user.avatarUrl}
                    alt={user.login || 'User'}
                    width={36}
                    height={36}
                    className="w-9 h-9 rounded-full hover:ring-2 hover:ring-blue-400 transition"
                  />
                </a>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="p-2 text-muted hover:text-foreground hover:bg-[#fffafa] dark:hover:bg-surface-hover rounded-lg transition"
                title="Logout"
              >
                <ExitIcon />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <Projects
          installations={installations}
          projects={projects}
          loading={loading}
          uploading={uploading}
          fileInputRef={fileInputRef}
          handleFileUpload={handleFileUpload}
          handleDeleteProject={handleDeleteProject}
          handleProjectClick={handleProjectClick}
          startScan={startScan}
          activeScanIds={activeScanIds}
          activeRemediationIds={activeRemediationIds}
          activeDeployIds={activeDeployIds}
          activeDeployProjectNames={activeDeployProjectNames}
        />
      </div>
    </div>
  );
}
