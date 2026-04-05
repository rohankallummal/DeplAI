'use client';

import { CostData } from '@/lib/deploy-context';

interface CostEstimationProps {
  costData: CostData;
  onDeploy: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function CostEstimation({ costData, onDeploy, onCancel, isLoading = false }: CostEstimationProps) {
  const hasError = costData.error;
  const totalMonthlyCost = costData.total_monthly_cost || 0;
  const totalHourlyCost = costData.total_hourly_cost || 0;
  const resources = costData.resources || [];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Deployment Cost Estimation</h2>
        <p className="text-muted">Review the estimated AWS costs before proceeding with deployment</p>
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
        <>
          {/* Cost Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="bg-surface border border-border rounded-lg p-6">
              <div className="text-sm text-muted mb-1">Monthly Cost</div>
              <div className="text-3xl font-bold text-foreground">
                ${totalMonthlyCost.toFixed(2)}
              </div>
              <div className="text-xs text-muted mt-1">
                {(totalMonthlyCost / 30).toFixed(2)} per day
              </div>
            </div>

            <div className="bg-surface border border-border rounded-lg p-6">
              <div className="text-sm text-muted mb-1">Hourly Cost</div>
              <div className="text-3xl font-bold text-foreground">
                ${totalHourlyCost.toFixed(4)}
              </div>
              <div className="text-xs text-muted mt-1">
                {(totalHourlyCost * 24 * 365).toFixed(2)} per year
              </div>
            </div>
          </div>

          {/* Resources Breakdown */}
          {resources.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-foreground mb-4">Resource Costs (Sorted by Monthly Cost)</h3>
              <div className="space-y-3">
                {resources.map((resource, idx) => (
                  <div key={idx} className="bg-surface border border-border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-foreground">{resource.name}</div>
                      <div className="text-lg font-semibold text-blue-600">
                        ${resource.monthly_cost.toFixed(2)}/mo
                      </div>
                    </div>

                    {/* Components Breakdown */}
                    {resource.components && resource.components.length > 0 && (
                      <div className="mt-3 pl-4 border-l border-border text-sm">
                        <div className="text-muted mb-2">Components:</div>
                        <div className="space-y-1">
                          {resource.components.map((comp, compIdx) => (
                            <div key={compIdx} className="flex justify-between text-muted">
                              <span>{comp.name}</span>
                              <span>${comp.monthly_cost.toFixed(2)}/mo</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              This is an estimate based on your Terraform configuration. Actual costs may vary depending on usage patterns and AWS pricing updates.
            </p>
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1 py-3 rounded-lg border border-border bg-surface text-foreground font-semibold hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Cancel
        </button>
        <button
          onClick={onDeploy}
          disabled={isLoading}
          className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {isLoading ? 'Deploying...' : 'Deploy'}
        </button>
      </div>
    </div>
  );
}
