'use client';

import { useEffect, useState } from 'react';
import { CostData } from '@/lib/deploy-context';

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
  costData?: CostData | null;
}

export function PostDeploymentDashboard({
  projectId,
  projectName,
  costData,
}: PostDeploymentDashboardProps) {
  const [outputs, setOutputs] = useState<OutputData['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealedCredentials, setRevealedCredentials] = useState<Record<string, boolean>>({});
  const [destroyLoading, setDestroyLoading] = useState(false);
  const [showDestroyModal, setShowDestroyModal] = useState(false);
  const [destroyError, setDestroyError] = useState<string | null>(null);
  const [destroySuccess, setDestroySuccess] = useState(false);

  useEffect(() => {
    fetchOutputs();
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
      setTimeout(() => fetchOutputs(), 2000);
    } catch (err) {
      console.error('Destroy failed:', err);
      setDestroyError('Failed to destroy resources');
    } finally {
      setDestroyLoading(false);
    }
  }

  function toggleReveal(name: string) {
    setRevealedCredentials(prev => ({
      ...prev,
      [name]: !prev[name],
    }));
  }

  function copyToClipboard(value: string) {
    navigator.clipboard.writeText(value);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted">Loading deployment outputs...</p>
      </div>
    );
  }

  if (error && !outputs) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-sm text-red-800 dark:text-red-200">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Access & Endpoints */}
      <section>
        <h3 className="text-lg font-semibold text-foreground mb-4">Access & Endpoints</h3>
        {outputs?.endpoints && outputs.endpoints.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {outputs.endpoints.map((endpoint, idx) => (
              <div key={idx} className="bg-surface border border-border rounded-lg p-4">
                <div className="text-sm text-muted mb-2 font-medium">{endpoint.name}</div>
                <div className="font-mono text-sm text-foreground break-all mb-3">{endpoint.value}</div>
                <button
                  onClick={() => copyToClipboard(endpoint.value as string)}
                  className="text-xs px-3 py-1 rounded-lg border border-border bg-surface hover:bg-surface-hover text-foreground transition"
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No public endpoints found</p>
        )}
      </section>

      {/* Infrastructure Inventory */}
      <section>
        <h3 className="text-lg font-semibold text-foreground mb-4">Infrastructure Inventory</h3>
        {outputs?.inventory && outputs.inventory.length > 0 ? (
          <div className="space-y-3">
            {outputs.inventory.map((item, idx) => (
              <div key={idx} className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm text-muted font-medium mb-1">{item.name}</div>
                    <div className="font-mono text-sm text-foreground break-all">{item.value}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted text-sm">No infrastructure resources found</p>
        )}

        {/* Cost-annotated resources */}
        {outputs?.cost_resources && outputs.cost_resources.length > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-foreground mb-3">Cost by Resource (Monthly)</h4>
            <div className="space-y-2">
              {outputs.cost_resources.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-surface border border-border rounded-lg">
                  <span className="text-sm text-foreground">{resource.name}</span>
                  <span className="text-sm font-semibold text-blue-600">${resource.monthly_cost.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Security & Access Credentials */}
      {outputs?.credentials && outputs.credentials.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-foreground mb-4">Security & Access Credentials</h3>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Store these securely. They will not be shown again.
            </p>
          </div>
          <div className="space-y-3">
            {outputs.credentials.map((cred, idx) => {
              const isRevealed = revealedCredentials[cred.name];
              return (
                <div key={idx} className="bg-surface border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm text-muted font-medium">{cred.name}</div>
                    {cred.sensitive && (
                      <span className="text-xs px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                        Sensitive
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-sm text-foreground break-all mb-3">
                    {isRevealed ? cred.value : '••••••••'}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleReveal(cred.name)}
                      className="text-xs px-3 py-1 rounded-lg border border-border bg-surface hover:bg-surface-hover text-foreground transition"
                    >
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                    <button
                      onClick={() => copyToClipboard(cred.value as string)}
                      className="text-xs px-3 py-1 rounded-lg border border-border bg-surface hover:bg-surface-hover text-foreground transition"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Delete Infrastructure */}
      <section className="border-t border-border pt-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">Delete Infrastructure</h3>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            Destroy all AWS resources. This action cannot be undone and will incur no further charges.
          </p>
          <button
            onClick={() => setShowDestroyModal(true)}
            disabled={destroyLoading || destroySuccess}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {destroySuccess ? 'Resources Destroyed' : destroyLoading ? 'Destroying...' : 'Destroy All Resources'}
          </button>
          {destroyError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-2">{destroyError}</p>
          )}
        </div>
      </section>

      {/* Destroy Confirmation Modal */}
      {showDestroyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setShowDestroyModal(false)}
          />
          <div className="relative bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[480px] mx-4 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Destroy Infrastructure?</h2>
            </div>

            <div className="px-6 py-4 flex-1">
              <p className="text-sm text-muted mb-4">
                This will permanently destroy all AWS resources created for <strong>{projectName}</strong>.
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
