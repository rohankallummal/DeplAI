'use client';

import Lottie from 'lottie-react';
import { FiDownload } from 'react-icons/fi';
import { CostData } from '@/lib/deploy-context';
import dollarAnimation from '@/components/animation/dollar.json';

interface CostEstimationProps {
  costData: CostData;
  onDeploy: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function buildBreakdownText(costData: CostData): string {
  if (costData.table) return costData.table;

  const lines: string[] = [
    'Deployment Cost Breakdown',
    '='.repeat(40),
    '',
    `Monthly Cost:  $${(costData.total_monthly_cost || 0).toFixed(2)}`,
    `Hourly Cost:   $${(costData.total_hourly_cost || 0).toFixed(4)}`,
    `Daily Cost:    $${((costData.total_monthly_cost || 0) / 30).toFixed(2)}`,
    `Yearly Cost:   $${((costData.total_hourly_cost || 0) * 24 * 365).toFixed(2)}`,
    '',
  ];

  const resources = costData.resources || [];
  if (resources.length > 0) {
    lines.push('Resources', '-'.repeat(40));
    for (const r of resources) {
      lines.push(`  ${r.name}  $${r.monthly_cost.toFixed(2)}/mo`);
      for (const c of r.components || []) {
        lines.push(`    - ${c.name}  $${c.monthly_cost.toFixed(2)}/mo`);
      }
    }
    lines.push('');
  }

  const s = costData.summary;
  if (s && s.total_resources > 0) {
    lines.push('Summary', '-'.repeat(40));
    lines.push(`  Total resources:       ${s.total_resources}`);
    lines.push(`  Estimated resources:   ${s.estimated_resources}`);
    lines.push(`  Free resources:        ${s.free_resources}`);
    lines.push(`  Unsupported resources: ${s.unsupported_resources}`);
  }

  return lines.join('\n');
}

function downloadBreakdown(costData: CostData) {
  const text = buildBreakdownText(costData);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cost-breakdown.txt';
  a.click();
  URL.revokeObjectURL(url);
}

export function CostEstimation({ costData, onDeploy, onCancel, isLoading = false }: CostEstimationProps) {
  const hasError = costData.error;
  const totalMonthlyCost = costData.total_monthly_cost || 0;
  const totalHourlyCost = costData.total_hourly_cost || 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-col items-center mb-6">
        <Lottie animationData={dollarAnimation} loop className="w-56 h-56" />
        <h2 className="text-2xl font-bold text-foreground">Deployment Cost Estimation</h2>
      </div>
      <div className="flex justify-end mb-6">
        {!hasError && (
          <button
            onClick={() => downloadBreakdown(costData)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface text-muted text-sm hover:text-foreground hover:bg-surface-hover transition"
          >
            <FiDownload className="w-4 h-4" />
            Breakdown
          </button>
        )}
      </div>

      {hasError ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Warning:</strong> {hasError}
          </p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-2">
            Cost estimation is optional. You can proceed with deployment.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="border border-border rounded-lg p-6 text-center bg-[#F5F5DC] dark:bg-[#353935]">
            <div className="text-sm text-muted mb-1">Monthly Cost</div>
            <div className="text-3xl font-bold text-foreground">
              ${totalMonthlyCost.toFixed(2)}
            </div>
            <div className="text-xs text-muted mt-1">
              ${(totalMonthlyCost / 30).toFixed(2)} per day
            </div>
          </div>

          <div className="border border-border rounded-lg p-6 text-center bg-[#F5F5DC] dark:bg-[#353935]">
            <div className="text-sm text-muted mb-1">Hourly Cost</div>
            <div className="text-3xl font-bold text-foreground">
              ${totalHourlyCost.toFixed(4)}
            </div>
            <div className="text-xs text-muted mt-1">
              ${(totalHourlyCost * 24 * 365).toFixed(2)} per year
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center gap-4 mt-12">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-8 py-3 rounded-lg border border-border bg-surface text-foreground font-semibold hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.21967 7.28033C5.92678 6.98744 5.92678 6.51256 6.21967 6.21967C6.51256 5.92678 6.98744 5.92678 7.28033 6.21967L11.999 10.9384L16.7176 6.2198C17.0105 5.92691 17.4854 5.92691 17.7782 6.2198C18.0711 6.51269 18.0711 6.98757 17.7782 7.28046L13.0597 11.999L17.7782 16.7176C18.0711 17.0105 18.0711 17.4854 17.7782 17.7782C17.4854 18.0711 17.0105 18.0711 16.7176 17.7782L11.999 13.0597L7.28033 17.7784C6.98744 18.0713 6.51256 18.0713 6.21967 17.7784C5.92678 17.4855 5.92678 17.0106 6.21967 16.7177L10.9384 11.999L6.21967 7.28033Z" fill="currentColor"/>
          </svg>
        </button>
        <button
          onClick={onDeploy}
          disabled={isLoading}
          className="px-8 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center"
        >
          {isLoading ? 'Deploying...' : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20.6216 4.04316C20.5821 3.69619 20.3083 3.4224 19.9614 3.38283C16.2551 2.96017 12.3947 4.17038 9.55023 7.01484C8.88176 7.6833 8.30341 8.40811 7.81526 9.174L7.81222 9.17412C7.73555 9.29444 7.6611 9.41579 7.58888 9.53809C6.86872 10.7576 6.37031 12.0714 6.09345 13.4211C6.0428 13.668 6.11958 13.9239 6.29782 14.1021L9.89702 17.7013C10.0752 17.8795 10.3311 17.9563 10.578 17.9057C11.9273 17.6291 13.2409 17.1311 14.4602 16.4114C15.3628 15.8787 16.2129 15.225 16.987 14.4509L16.9887 14.4525C19.8326 11.6087 21.0435 7.74873 20.6216 4.04316ZM16.0256 7.9789C16.9258 8.87906 16.9258 10.3385 16.0256 11.2387C15.1255 12.1388 13.666 12.1388 12.7659 11.2387C11.8657 10.3385 11.8657 8.87906 12.7659 7.9789C13.666 7.07874 15.1255 7.07874 16.0256 7.9789Z" fill="currentColor"/>
              <path d="M14.6579 17.4504C13.4302 18.1321 12.1206 18.6103 10.7788 18.8853C10.5634 18.9295 10.3452 18.9321 10.1346 18.8963C10.256 19.6277 10.2443 20.3772 10.0992 21.1059C10.0429 21.3884 10.1534 21.6782 10.3836 21.8515C10.6137 22.0248 10.9228 22.0509 11.1788 21.9188C11.7836 21.6065 12.3505 21.1972 12.856 20.6917C13.7817 19.766 14.3823 18.6383 14.6579 17.4504Z" fill="currentColor"/>
              <path d="M5.10306 13.866C5.06703 13.6549 5.06956 13.4361 5.11385 13.2201C5.38883 11.8796 5.86653 10.5713 6.54731 9.34479C5.36096 9.62075 4.23474 10.2211 3.31006 11.1457C2.80493 11.6509 2.39581 12.2173 2.08364 12.8217C1.95144 13.0776 1.97753 13.3867 2.15076 13.6169C2.324 13.847 2.61377 13.9577 2.89631 13.9015C3.62408 13.7567 4.37256 13.7449 5.10306 13.866Z" fill="currentColor"/>
              <path d="M3.03001 20.25C3.04425 20.6429 3.35947 20.9583 3.75235 20.9725L3.75361 20.9726L3.75565 20.9727L3.76203 20.9729L3.78367 20.9735C3.79965 20.9739 3.82143 20.9744 3.8484 20.9749L3.86028 20.9751C3.92523 20.9761 4.01715 20.9767 4.12879 20.9755C4.35089 20.9731 4.65671 20.9631 4.9863 20.9323C5.31222 20.9019 5.68221 20.8492 6.02513 20.7549C6.34629 20.6666 6.74723 20.5151 7.03929 20.223C7.93945 19.3229 7.93945 17.8634 7.03929 16.9633C6.13913 16.0631 4.67969 16.0631 3.77953 16.9633C3.48747 17.2553 3.33595 17.6563 3.24764 17.9774C3.15335 18.3204 3.10068 18.6903 3.07022 19.0163C3.03942 19.3459 3.02946 19.6517 3.02704 19.8738C3.02582 19.9854 3.02649 20.0773 3.0275 20.1423C3.028 20.1748 3.02859 20.2006 3.02907 20.2189L3.0297 20.2405L3.0299 20.2469L3.03001 20.25Z" fill="currentColor"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
