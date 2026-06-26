'use client';

import { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/loading-spinner';
import { getErrorMessage } from '@/lib/backend';

export interface DeplaiPr {
  number: number;
  head_ref: string;
  base_ref: string;
  html_url: string;
  title?: string;
}

export interface BranchSelection {
  base_branch: string;
  mode: 'continue' | 'new';
  pr?: DeplaiPr;
}

interface BranchSelectModalProps {
  owner: string;
  repo: string;
  projectId: string;
  defaultBranch: string;
  onClose: () => void;
  onConfirm: (selection: BranchSelection) => void;
  // 'preview' relabels the customize-oriented copy for the Live Preview flow.
  // Selection mechanics are identical: `continue` → a customization PR's head
  // branch, `new` → the chosen branch as-is.
  mode?: 'customize' | 'preview';
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-5 right-5 p-1.5 text-muted hover:text-foreground rounded-lg transition"
      aria-label="Close"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6L6 18" /><path d="M6 6l12 12" />
      </svg>
    </button>
  );
}

function BranchIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M17 7H8M17 7v9" />
    </svg>
  );
}

const PRIMARY_BTN = 'py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY_BTN = 'py-2.5 px-3.5 text-sm font-medium text-foreground hover:bg-surface-hover rounded-lg border border-border transition whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';
const TERTIARY_BTN = 'text-sm font-medium text-muted hover:text-foreground transition whitespace-nowrap shrink-0';

function StepHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-7 pt-7">
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function PrRow({ pr, selected, onSelect }: { pr: DeplaiPr; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg border transition cursor-pointer ${
        selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-border hover:bg-surface-hover'
      }`}
    >
      <input
        type="radio"
        name="deplai-pr"
        checked={selected}
        onChange={onSelect}
        className="accent-blue-600 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">PR #{pr.number}</p>
        {pr.title && <p className="text-xs text-muted truncate mt-0.5">{pr.title}</p>}
      </div>
      <a
        href={pr.html_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 p-1 text-muted hover:text-blue-600 dark:hover:text-blue-400 transition"
        aria-label={`Open PR #${pr.number} on GitHub`}
      >
        <ExternalLinkIcon />
      </a>
    </label>
  );
}

export default function BranchSelectModal({ owner, repo, projectId, defaultBranch, onClose, onConfirm, mode = 'customize' }: BranchSelectModalProps) {
  const isPreview = mode === 'preview';
  const [step, setStep] = useState<1 | 2>(1);

  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchSearch, setBranchSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');

  const [allPulls, setAllPulls] = useState<DeplaiPr[]>([]);
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  // One fetch backs both steps: the customizable branches and this project's open
  // DeplAI PRs (Step 2 filters them by the chosen base client-side).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBranchesLoading(true);
      setBranchesError(null);
      try {
        const res = await fetch(
          `/api/customize/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}` +
          `&project_id=${encodeURIComponent(projectId)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Failed to load branches');
        setBranches(data.branches || []);
        setAllPulls(data.pulls || []);
        // No auto-selection — the user must explicitly choose a branch before proceeding.
      } catch (err) {
        if (!cancelled) setBranchesError(getErrorMessage(err, 'Failed to load branches'));
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [owner, repo, projectId]);

  // Default branch first so the pre-selection is always visible at the top.
  const visibleBranches = branches
    .filter(b => b.toLowerCase().includes(branchSearch.toLowerCase()))
    .sort((a, b) => (a === defaultBranch ? -1 : b === defaultBranch ? 1 : 0));

  // DeplAI customizations targeting the chosen base (derived from the single fetch).
  const prsForBase = allPulls.filter(p => p.base_ref === selectedBranch);
  const prSelected = selectedPrNumber !== null;

  function goToStep2() {
    setSelectedPrNumber(null);
    setStep(2);
  }

  function back() {
    setSelectedPrNumber(null);
    setStep(1);
  }

  function startNew() {
    onConfirm({ base_branch: selectedBranch, mode: 'new' });
  }

  function continueExisting() {
    const pr = prsForBase.find(p => p.number === selectedPrNumber);
    if (!pr) return;
    onConfirm({ base_branch: selectedBranch, mode: 'continue', pr });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_150ms_ease-out]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl bg-surface border border-border animate-[scaleIn_200ms_ease-out]">
        <CloseButton onClick={onClose} />

        {step === 1 ? (
          <>
            <StepHeader title={isPreview ? 'Select a branch to preview' : 'Select a base branch'}>
              <p className="text-muted text-sm mt-1.5 leading-relaxed">
                {isPreview ? 'Choose the branch you want to preview.' : 'Choose the branch you want to customize.'}
              </p>
            </StepHeader>

            <div className="px-7 pt-5 pb-1">
              {branchesLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><SearchIcon /></span>
                    <input
                      type="text"
                      value={branchSearch}
                      onChange={(e) => setBranchSearch(e.target.value)}
                      placeholder="Search branches"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-search text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>

                  <div className="mt-3 rounded-xl border border-border overflow-hidden">
                    <div className="max-h-[216px] overflow-y-auto scrollbar-hidden divide-y divide-border">
                      {branchesError ? (
                        <p className="px-4 py-8 text-sm text-red-500 text-center">{branchesError}</p>
                      ) : visibleBranches.length === 0 ? (
                        <p className="px-4 py-8 text-sm text-muted text-center">No customizable branches found</p>
                      ) : (
                        visibleBranches.map(b => {
                          const isSelected = b === selectedBranch;
                          return (
                            <button
                              key={b}
                              onClick={() => setSelectedBranch(b)}
                              className={`w-full px-3.5 py-2.5 text-left text-sm transition flex items-center gap-3 ${
                                isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-surface-hover'
                              }`}
                            >
                              <BranchIcon className={`shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-muted'}`} />
                              <span className={`truncate flex-1 ${isSelected ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-foreground'}`}>{b}</span>
                              {b === defaultBranch && (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-muted border border-border rounded px-1.5 py-0.5 shrink-0">default</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {!branchesLoading && (
              <div className="px-7 py-4 mt-3 border-t border-border flex items-center justify-between">
                <button onClick={onClose} className={TERTIARY_BTN}>Cancel</button>
                <button onClick={goToStep2} disabled={!selectedBranch} className={PRIMARY_BTN}>Next</button>
              </div>
            )}
          </>
        ) : (
          <>
            <StepHeader title={isPreview ? 'Choose what to preview' : 'Continue or start new'}>
              <div className="mt-2 inline-flex items-center gap-1.5 max-w-full rounded-lg bg-card border border-border px-2.5 py-1">
                <BranchIcon className="w-3.5 h-3.5 text-muted shrink-0" />
                <span className="text-xs text-muted shrink-0">Base</span>
                <span className="text-xs font-medium text-foreground truncate">{selectedBranch}</span>
              </div>
            </StepHeader>

            <div className="px-7 pt-5 pb-1">
              <div className="min-h-[112px]">
                {prsForBase.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-sm font-medium text-foreground">No existing customizations</p>
                    <p className="text-sm text-muted mt-1">
                      {isPreview
                        ? 'You’ll preview this branch as-is.'
                        : 'DeplAI hasn’t opened a customization on this branch yet.'}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted mb-2.5">
                      {prsForBase.length === 1
                        ? 'Existing customization'
                        : isPreview ? 'Customizations on this branch' : 'Continue an existing customization'}
                    </p>
                    <div className="space-y-2">
                      {prsForBase.map(pr => (
                        <PrRow
                          key={pr.number}
                          pr={pr}
                          selected={selectedPrNumber === pr.number}
                          onSelect={() => setSelectedPrNumber(pr.number)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-7 py-4 mt-3 border-t border-border flex items-center justify-between gap-2">
              <button onClick={back} className={TERTIARY_BTN}>Back</button>
              <div className={`grid gap-2 ${prSelected ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {prSelected && (
                  <button onClick={continueExisting} className={PRIMARY_BTN}>
                    {isPreview ? 'Preview PR' : 'Continue PR'}
                  </button>
                )}
                <button
                  onClick={startNew}
                  className={prSelected ? SECONDARY_BTN : PRIMARY_BTN}
                >
                  {isPreview
                    ? 'Preview Branch'
                    : prsForBase.length > 0 ? 'New Chat' : 'Start Customization'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
