'use client';

import { useState } from 'react';
import Lottie from 'lottie-react';
import { FiDownload } from 'react-icons/fi';
import { CostData } from '@/lib/deploy-context';
import dollarAnimation from '@/components/animation/dollar.json';

interface CostEstimationProps {
  projectId: string;
  costData: CostData;
  onDeploy: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

async function downloadBreakdownPdf(projectId: string): Promise<void> {
  const res = await fetch(`/api/deploy/cost-pdf/${projectId}`);
  if (!res.ok) {
    throw new Error(`Failed to generate PDF (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cost-breakdown.pdf';
  a.click();
  URL.revokeObjectURL(url);
}

function formatUSD(value: number, fractionDigits = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function CostEstimation({ projectId, costData, onDeploy, onCancel, isLoading = false }: CostEstimationProps) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const hasError = costData.error;

  const handleDownload = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      await downloadBreakdownPdf(projectId);
    } catch (err) {
      console.error(err);
    } finally {
      setPdfLoading(false);
    }
  };
  const totalMonthly = costData.total_monthly_cost || 0;
  const totalHourly = costData.total_hourly_cost || 0;
  const dailyCost = totalMonthly / 30;
  const yearlyCost = totalHourly * 24 * 365;
  const PREVIEW_LIMIT = 5;
  const allResources = costData.resources || [];
  const resources = allResources.slice(0, PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, allResources.length - resources.length);
  const summary = costData.summary;
  const maxResourceCost = resources.reduce((m, r) => Math.max(m, r.monthly_cost), 0) || 1;

  return (
    <div className="max-w-5xl mx-auto px-2">
      <style>{`
        @keyframes costRise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes costBar {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .cost-rise { opacity: 0; animation: costRise 620ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
        .cost-bar  { transform-origin: left; transform: scaleX(0); animation: costBar 900ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
      `}</style>

      {/* Masthead */}
      <div
        className="cost-rise flex items-end justify-between gap-6 pb-6"
        style={{ animationDelay: '0ms' }}
      >
        <div className="flex items-center gap-3">
          <Lottie animationData={dollarAnimation} loop className="w-16 h-16 -ml-1 -my-2" />
          <div>
            <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1.5">
              Statement · Pre-deployment
            </div>
            <h2 className="text-3xl md:text-4xl text-foreground leading-[1.05]">
              Cost Estimation
            </h2>
          </div>
        </div>
        {!hasError && (
          <button
            onClick={handleDownload}
            disabled={pdfLoading}
            className="flex items-center gap-2 px-4 py-2.5 border border-border bg-surface text-muted text-[11px] uppercase tracking-[0.16em] hover:text-foreground hover:border-foreground disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            <FiDownload className="w-3.5 h-3.5" />
            {pdfLoading ? 'Preparing…' : 'Breakdown'}
          </button>
        )}
      </div>

      {hasError ? (
        <div
          className="cost-rise bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-5 my-8"
          style={{ animationDelay: '120ms' }}
        >
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong className="uppercase tracking-[0.14em] text-[11px] mr-2">Notice</strong>
            {hasError}
          </p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-2">
            Cost estimation is optional. You can proceed with deployment.
          </p>
        </div>
      ) : (
        <div className="border border-border px-6 md:px-10 mt-2">
          {/* Hero price + secondary strip */}
          <div
            className="cost-rise grid grid-cols-1 md:grid-cols-12 gap-x-8 gap-y-8 py-12 border-b border-border -mx-6 md:-mx-10 px-6 md:px-10"
            style={{ animationDelay: '80ms' }}
          >
            <div className="md:col-span-7">
              <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-4">
                Projected monthly
              </div>
              <div className="flex items-start">
                <span className="text-3xl md:text-5xl text-muted mt-3 md:mt-4 mr-1">$</span>
                <span className="text-6xl md:text-[7.5rem] leading-[0.9] text-foreground tabular-nums tracking-tight">
                  {formatUSD(totalMonthly)}
                </span>
              </div>
              <div className="mt-5 inline-flex items-center gap-3 text-[10px] uppercase tracking-[0.22em] text-muted">
                <span className="h-px w-10 bg-border" />
                <span>Per month · all resources</span>
              </div>
            </div>

            <div className="md:col-span-5 md:border-l md:border-border md:pl-8 flex flex-col gap-6 content-start">
              <MetricCell label="Hourly" value={`$${formatUSD(totalHourly, 4)}`} />
              <MetricCell label="Daily" value={`$${formatUSD(dailyCost)}`} />
              <MetricCell label="Yearly" value={`$${formatUSD(yearlyCost)}`} />
            </div>
          </div>

          {/* Ledger */}
          {resources.length > 0 && (
            <div
              className="cost-rise py-12 border-b border-border -mx-6 md:-mx-10 px-6 md:px-10"
              style={{ animationDelay: '160ms' }}
            >
              <div className="flex items-baseline justify-between mb-6 gap-4">
                <div>
                  <div className="text-[10px] tracking-[0.22em] uppercase text-muted mb-1.5 flex items-center gap-2">
                    <span>Line items</span>
                    <span className="inline-flex items-center px-1.5 py-[2px] border border-emerald-700/60 dark:border-emerald-400/60 text-emerald-800 dark:text-emerald-300 text-[9px] tracking-[0.22em] uppercase leading-none">
                      Preview
                    </span>
                  </div>
                  <h3 className="text-2xl md:text-3xl text-foreground">
                    Ledger
                  </h3>
                </div>
                <div className="text-[10px] tracking-[0.18em] uppercase text-muted text-right">
                  By monthly cost
                </div>
              </div>

              <div className="grid grid-cols-12 gap-4 items-center text-[10px] uppercase tracking-[0.18em] text-muted pb-3 border-b border-border">
                <div className="col-span-4">Resource</div>
                <div className="col-span-5">Share</div>
                <div className="col-span-3 text-right">Monthly</div>
              </div>

              <ul>
                {resources.map((r, i) => {
                  const share = r.monthly_cost / maxResourceCost;
                  const hasComponents = r.components && r.components.length > 0;
                  return (
                    <li
                      key={`${r.name}-${i}`}
                      className="border-b border-border/60 last:border-b-0 hover:bg-[#F5F5DC]/40 dark:hover:bg-[#353935]/40 transition-colors"
                    >
                      <div className="grid grid-cols-12 gap-4 items-center py-4">
                        <div className="col-span-4 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {r.name}
                          </div>
                          {hasComponents && (
                            <div className="text-[11px] text-muted mt-0.5 tracking-wide">
                              {r.components.length} component{r.components.length !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                        <div className="col-span-5">
                          <div className="h-[5px] bg-border/50 w-full relative overflow-hidden">
                            <div
                              className="cost-bar absolute inset-y-0 left-0 bg-emerald-700 dark:bg-emerald-400"
                              style={{
                                width: `${Math.max(share * 100, 2)}%`,
                                animationDelay: `${260 + i * 70}ms`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="col-span-3 text-right">
                          <span className="text-lg text-foreground tabular-nums">
                            ${formatUSD(r.monthly_cost)}
                          </span>
                          <span className="text-[10px] text-muted tracking-[0.14em] uppercase ml-1">
                            /mo
                          </span>
                        </div>
                      </div>

                      {hasComponents && (
                        <ul className="pb-4 pl-5 ml-1 space-y-1.5">
                          {r.components.map((c, j) => (
                            <li
                              key={`${c.name}-${j}`}
                              className="flex items-baseline justify-between gap-6 text-xs text-muted"
                            >
                              <span className="truncate pr-4">
                                {c.name}
                              </span>
                              <span className="tabular-nums whitespace-nowrap">
                                ${formatUSD(c.monthly_cost)}
                                <span className="ml-1 tracking-[0.12em] uppercase text-[9px]">/mo</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              {hiddenCount > 0 && (
                <div className="mt-4 pt-3 text-[11px] uppercase tracking-[0.18em] text-muted flex items-center justify-between">
                  <span>
                    Showing top {resources.length} · {hiddenCount} more line item{hiddenCount !== 1 ? 's' : ''} hidden
                  </span>
                  <span>Open Breakdown for full ledger</span>
                </div>
              )}
            </div>
          )}

          {/* Summary tiles */}
          {summary && summary.total_resources > 0 && (
            <div
              className="cost-rise py-12 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-8"
              style={{ animationDelay: '240ms' }}
            >
              <SummaryCell label="Total" value={summary.total_resources} />
              <SummaryCell label="Estimated" value={summary.estimated_resources} />
              <SummaryCell label="Free tier" value={summary.free_resources} />
              <SummaryCell
                label="Unsupported"
                value={summary.unsupported_resources}
                warn={summary.unsupported_resources > 0}
              />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div
        className="cost-rise flex justify-end items-center gap-3 pt-10"
        style={{ animationDelay: '320ms' }}
      >
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex items-center gap-2 px-5 py-3 border border-border bg-surface text-muted text-[11px] uppercase tracking-[0.18em] hover:text-foreground hover:border-foreground disabled:opacity-50 disabled:cursor-not-allowed transition"
          aria-label="Cancel deployment"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M6.21967 7.28033C5.92678 6.98744 5.92678 6.51256 6.21967 6.21967C6.51256 5.92678 6.98744 5.92678 7.28033 6.21967L11.999 10.9384L16.7176 6.2198C17.0105 5.92691 17.4854 5.92691 17.7782 6.2198C18.0711 6.51269 18.0711 6.98757 17.7782 7.28046L13.0597 11.999L17.7782 16.7176C18.0711 17.0105 18.0711 17.4854 17.7782 17.7782C17.4854 18.0711 17.0105 18.0711 16.7176 17.7782L11.999 13.0597L7.28033 17.7784C6.98744 18.0713 6.51256 18.0713 6.21967 17.7784C5.92678 17.4855 5.92678 17.0106 6.21967 16.7177L10.9384 11.999L6.21967 7.28033Z"
              fill="currentColor"
            />
          </svg>
          Cancel
        </button>
        <button
          onClick={onDeploy}
          disabled={isLoading}
          className="group flex items-center gap-2.5 px-6 py-3 bg-emerald-800 dark:bg-emerald-500 text-white dark:text-emerald-950 text-[11px] uppercase tracking-[0.18em] font-semibold hover:bg-emerald-900 dark:hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? 'Authorising…' : 'Authorise Deployment'}
          {!isLoading && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <path
                d="M5 12H19M19 12L13 6M19 12L13 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted mb-2">{label}</div>
      <div className="text-xl md:text-2xl text-foreground tabular-nums leading-none">
        {value}
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-[0.2em] mb-3 ${
          warn ? 'text-amber-600 dark:text-amber-400' : 'text-muted'
        }`}
      >
        {label}
      </div>
      <div
        className={`text-4xl md:text-5xl tabular-nums leading-none ${
          warn ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'
        }`}
      >
        {String(value).padStart(2, '0')}
      </div>
    </div>
  );
}
