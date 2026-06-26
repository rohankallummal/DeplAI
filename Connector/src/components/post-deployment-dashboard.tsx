'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiCopy, FiExternalLink, FiTrash2, FiCheck } from 'react-icons/fi';

interface OutputData {
  success: boolean;
  error?: string;
  data?: {
    endpoints: Array<{ name: string; value: string }>;
    credentials: Array<{ name: string; value: string; sensitive: boolean }>;
    inventory: Array<{ name: string; value: string }>;
    cost_resources: Array<{ name: string; monthly_cost: number }>;
  };
}

interface PostDeploymentDashboardProps {
  projectId: string;
  projectName: string;
}

function pickApplicationUrl(
  endpoints: Array<{ name: string; value: string }> | undefined
): { name: string; value: string } | null {
  if (!endpoints || endpoints.length === 0) return null;
  const preferred = endpoints.find(e => /url|endpoint/i.test(e.name));
  return preferred ?? endpoints[0];
}

function ensureHttp(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

export function PostDeploymentDashboard({
  projectId,
  projectName,
}: PostDeploymentDashboardProps) {
  const router = useRouter();
  const [outputs, setOutputs] = useState<OutputData['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [destroyLoading, setDestroyLoading] = useState(false);
  const [showDestroyModal, setShowDestroyModal] = useState(false);
  const [destroyError, setDestroyError] = useState<string | null>(null);
  const [destroySuccess, setDestroySuccess] = useState(false);

  useEffect(() => {
    fetchOutputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when projectId changes; fetchOutputs is stable
  }, [projectId]);

  async function fetchOutputs() {
    try {
      setLoading(true);
      const res = await fetch(`/api/deploy/outputs?project_id=${projectId}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to fetch outputs');
        return;
      }

      setOutputs(data.data);
    } catch (err) {
      console.error('Failed to fetch outputs:', err);
      setError('Failed to load deployment outputs');
    } finally {
      setLoading(false);
    }
  }

  async function handleDestroy() {
    try {
      setDestroyLoading(true);
      setDestroyError(null);
      const res = await fetch('/api/deploy/destroy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setDestroyError(data.message || 'Failed to destroy resources');
        return;
      }

      setDestroySuccess(true);
      setShowDestroyModal(false);
      setTimeout(() => router.push('/webpages'), 1500);
    } catch (err) {
      console.error('Destroy failed:', err);
      setDestroyError('Failed to destroy resources');
    } finally {
      setDestroyLoading(false);
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // noop
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted text-sm">Loading deployment outputs...</p>
      </div>
    );
  }

  if (error && !outputs) {
    return (
      <div className="max-w-2xl mx-auto bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm text-red-800 dark:text-red-200">Error: {error}</p>
      </div>
    );
  }

  const appUrl = pickApplicationUrl(outputs?.endpoints);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Application URL card */}
      <section className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
            Application URL
          </h3>
          {appUrl && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </div>

        {appUrl ? (
          <>
            <div className="font-mono text-base text-foreground break-all mb-5 leading-relaxed">
              {appUrl.value}
            </div>

            <div className="flex gap-2">
              <a
                href={ensureHttp(appUrl.value)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90 transition"
              >
                <FiExternalLink className="w-4 h-4" />
                Open
              </a>
              <button
                onClick={() => handleCopy(appUrl.value)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface text-foreground text-sm font-medium hover:bg-card transition"
              >
                {copied ? (
                  <>
                    <FiCheck className="w-4 h-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <FiCopy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            No application URL was exposed by this deployment.
          </p>
        )}
      </section>

      {/* Delete card */}
      <section className="bg-surface border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Delete Deployment
            </h3>
            <p className="text-sm text-muted leading-relaxed">
              Permanently destroy all AWS resources for{' '}
              <span className="font-medium text-foreground">{projectName}</span>.
              This action cannot be undone.
            </p>
            {destroyError && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                {destroyError}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowDestroyModal(true)}
            disabled={destroyLoading || destroySuccess}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex-shrink-0"
          >
            <FiTrash2 className="w-4 h-4" />
            {destroySuccess ? 'Destroyed' : destroyLoading ? 'Destroying...' : 'Delete'}
          </button>
        </div>
      </section>

      {showDestroyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => !destroyLoading && setShowDestroyModal(false)}
          />
          <div className="relative bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[480px] mx-4 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Destroy Infrastructure?</h2>
            </div>

            <div className="px-6 py-4 flex-1">
              <p className="text-sm text-muted mb-4">
                This will permanently destroy all AWS resources created for{' '}
                <strong className="text-foreground">{projectName}</strong>.
              </p>
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">
                This action cannot be undone.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-border flex gap-3">
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyLoading}
                className="flex-1 py-3 px-4 bg-gray-200 hover:bg-gray-300 dark:bg-[#141414] dark:hover:bg-[#222] text-gray-900 dark:text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDestroy}
                disabled={destroyLoading}
                className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {destroyLoading ? 'Destroying...' : 'Destroy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
