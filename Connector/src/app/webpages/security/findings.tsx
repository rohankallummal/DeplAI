'use client';

import { useState, useEffect } from 'react';
import { useScan, type VulnStatus } from '@/lib/scan-context';
import LoadingSpinner from '@/components/loading-spinner';
import Lottie from 'lottie-react';
import waitAnimation from '@/components/animation/wait.json';
import waitDarkAnimation from '@/components/animation/wait-dark.json';
import runAnimation from '@/components/animation/run.json';
import aiThinkAnimation from '@/components/animation/ai-think.json';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';

interface Occurrence {
  filename: string;
  line_number: number;
  code_extract: string;
  documentation_url: string;
}

interface CWEGroup {
  cwe_id: string;
  title: string;
  severity: string;
  count: number;
  occurrences: Occurrence[];
}

interface SupplyChainVuln {
  name: string;
  type: string;
  version: string;
  severity: string;
  epss_score: number | null;
  fix_version: string | null;
  cve_id: string;
}

interface ScanResults {
  supply_chain: SupplyChainVuln[];
  code_security: CWEGroup[];
}

interface FindingsProps {
  projectId?: string;
  remediating?: boolean;
  remediationDone?: boolean;
  onCleanScan?: () => void;
  onFindingsReady?: (ready: boolean) => void;
}

const SEVERITY_CONFIG: Record<string, { text: string; label: string }> = {
  critical: { text: 'text-red-500', label: 'Critical' },
  high: { text: 'text-orange-500', label: 'High' },
  medium: { text: 'text-yellow-500', label: 'Medium' },
  low: { text: 'text-blue-400', label: 'Low' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const config = SEVERITY_CONFIG[severity.toLowerCase()] || SEVERITY_CONFIG.low;
  return (
    <span className={`font-medium text-sm ${config.text}`}>
      {config.label}
    </span>
  );
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function SortIcon({ direction }: { direction: 'asc' | 'desc' | false }) {
  if (!direction) {
    return (
      <svg className="w-3.5 h-3.5 ml-1 inline text-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5 ml-1 inline text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={direction === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
    </svg>
  );
}

const supplyChainColumns: ColumnDef<SupplyChainVuln>[] = [
  {
    accessorKey: 'name',
    header: 'Package',
    cell: (info) => <span className="font-medium text-foreground">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'cve_id',
    header: 'CVE',
    cell: (info) => <span className="font-mono text-xs text-muted">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: (info) => <span className="text-muted text-xs">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'version',
    header: 'Version',
    cell: (info) => <span className="font-mono text-xs text-foreground/80">{info.getValue<string>()}</span>,
  },
  {
    accessorKey: 'severity',
    header: 'Severity',
    cell: (info) => <SeverityBadge severity={info.getValue<string>()} />,
    sortingFn: (rowA, rowB) => {
      const a = SEVERITY_ORDER[rowA.original.severity.toLowerCase()] ?? 4;
      const b = SEVERITY_ORDER[rowB.original.severity.toLowerCase()] ?? 4;
      return a - b;
    },
  },
  {
    accessorKey: 'epss_score',
    header: 'EPSS',
    cell: (info) => {
      const val = info.getValue<number | null>();
      return <span className="text-muted text-xs">{val !== null ? `${(val * 100).toFixed(1)}%` : '-'}</span>;
    },
  },
  {
    accessorKey: 'fix_version',
    header: 'Fix Available',
    meta: { align: 'right' as const },
    cell: (info) => {
      const val = info.getValue<string | null>();
      return val ? (
        <span className="inline-flex items-center justify-end gap-1.5 font-medium text-emerald-500">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {val}
        </span>
      ) : (
        <span className="text-muted/50 italic">None</span>
      );
    },
  },
];

function SupplyChainTable({ vulnerabilities }: { vulnerabilities: SupplyChainVuln[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: vulnerabilities,
    columns: supplyChainColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto w-full rounded-xl border border-black dark:border-white">
      <table className="w-full text-sm text-left whitespace-nowrap">
        <thead className="bg-white dark:bg-black text-muted text-xs uppercase tracking-wider">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-black dark:border-white">
              {headerGroup.headers.map((header) => {
                const align = (header.column.columnDef.meta as { align?: string })?.align;
                return (
                  <th
                    key={header.id}
                    className={`py-3 px-6 font-semibold select-none ${
                      header.column.getCanSort() ? 'cursor-pointer hover:text-foreground transition-colors' : ''
                    } ${align === 'right' ? 'text-right' : ''}`}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanSort() && (
                      <SortIcon direction={header.column.getIsSorted()} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-black dark:divide-white">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-hover/20 transition-colors">
              {row.getVisibleCells().map((cell) => {
                const align = (cell.column.columnDef.meta as { align?: string })?.align;
                return (
                  <td
                    key={cell.id}
                    className={`py-3.5 px-6 ${align === 'right' ? 'text-right font-mono text-xs' : ''}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CWEAccordion({ group }: { group: CWEGroup }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden transition-all duration-200 ${expanded ? 'shadow-md' : 'shadow-sm'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left focus:outline-none focus:ring-2 focus:ring-border inset-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-4 h-4 text-muted shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <SeverityBadge severity={group.severity} />
          <span className="font-semibold text-foreground text-sm truncate ml-1">
            <span className="text-muted font-normal mr-2">CWE-{group.cwe_id}</span>
            {group.title}
          </span>
        </div>
        <span className={`shrink-0 ml-3 inline-flex items-center justify-center min-w-[28px] h-6 px-2.5 rounded-full text-xs font-bold bg-surface-hover text-muted`}>
          {group.count}
        </span>
      </button>

      <div className={`grid transition-all duration-200 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border/50 bg-surface/50">
            {group.occurrences.map((occ, i) => (
              <div key={i} className="px-5 py-4 border-b border-border/30 last:border-b-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-sm min-w-0 bg-surface-hover px-3 py-1.5 rounded-md border border-border/50">
                    <svg className="w-4 h-4 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-foreground font-mono text-xs truncate">{occ.filename}</span>
                    <span className="text-muted/70 text-xs shrink-0 font-mono">:{occ.line_number}</span>
                  </div>
                  {occ.documentation_url && (
                    <a
                      href={occ.documentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors shrink-0 ml-2 bg-blue-500/10 px-2 py-1 rounded"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Docs
                    </a>
                  )}
                </div>

                <div className="rounded-lg bg-[#0d1117] border border-gray-800 overflow-hidden flex">
                  <div className="bg-[#161b22] text-gray-500 px-3 py-3 text-xs font-mono text-right select-none border-r border-gray-800 min-w-[40px]">
                    {occ.line_number}
                  </div>
                  <div className="p-3 overflow-x-auto w-full">
                    <pre className="text-xs font-mono text-gray-300 whitespace-pre">
                      {occ.code_extract}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Findings({ projectId, remediating, remediationDone, onCleanScan, onFindingsReady }: FindingsProps) {
  const { getScanState, getCachedResults, setCachedResults } = useScan();
  const { state } = getScanState(projectId || '');

  const [vulnStatus, setVulnStatus] = useState<VulnStatus>('not_initiated');
  const [results, setResults] = useState<ScanResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStatusAndResults(
    cancelled: { current: boolean },
    opts?: { trackError?: boolean; afterScanComplete?: boolean },
  ) {
    try {
      const statusRes = await fetch(`/api/scan/status?project_id=${projectId}`);
      const statusData = await statusRes.json();
      if (cancelled.current) return;

      const status: VulnStatus = statusData.status || 'not_initiated';
      setVulnStatus(status);

      if (status === 'found' || status === 'not_remediated' || status === 'remediated') {
        setLoadingResults(true);
        setLoading(false);
        try {
          const resultsRes = await fetch(`/api/scan/results?project_id=${projectId}`);
          if (!resultsRes.ok) {
            const d = await resultsRes.json().catch(() => ({}));
            throw new Error(d.error || 'Failed to fetch results');
          }
          const d = await resultsRes.json();
          if (!cancelled.current && d.data) {
            const hasVulns = d.data.supply_chain?.length > 0 || d.data.code_security?.length > 0;
            if (hasVulns) {
              setResults(d.data);
              if (projectId) setCachedResults(projectId, { status: 'found', data: d.data });
              onFindingsReady?.(true);
            } else {
              setVulnStatus('not_found');
              if (projectId) setCachedResults(projectId, { status: 'not_found', data: null });
              if (opts?.afterScanComplete) onCleanScan?.();
            }
          }
        } catch (err) {
          if (!cancelled.current && opts?.trackError) {
            setError(typeof err === 'string' ? err : (err as Error).message || 'Failed to load scan results');
          }
        } finally {
          if (!cancelled.current) setLoadingResults(false);
        }
        return;
      }

      if (status === 'not_found') {
        if (projectId) setCachedResults(projectId, { status, data: null });
        if (opts?.afterScanComplete) onCleanScan?.();
      }
      setLoading(false);
    } catch {
      if (!cancelled.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!projectId || state === 'running') {
      setLoading(false);
      return;
    }

    const cached = getCachedResults(projectId);
    if (cached) {
      setVulnStatus(cached.status);
      if (cached.status === 'found' && cached.data) {
        setResults(cached.data as ScanResults);
        onFindingsReady?.(true);
      }
      setLoading(false);
      return;
    }

    const cancelled = { current: false };
    setLoading(true);
    fetchStatusAndResults(cancelled);
    return () => { cancelled.current = true; };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || state !== 'completed') return;

    const cancelled = { current: false };
    setError(null);
    setLoading(true);
    onFindingsReady?.(false);
    fetchStatusAndResults(cancelled, { trackError: true, afterScanComplete: true });
    return () => { cancelled.current = true; };
  }, [projectId, state]);

  if (remediating) {
    return (
      <div className="p-12 h-full flex flex-col items-center justify-center min-h-[400px]">
        <Lottie
          animationData={aiThinkAnimation}
          loop
          className="w-72 h-72 mb-4"
        />
        <h3 className="text-xl font-semibold text-foreground mb-2">
          Remediating
        </h3>
        <p className="text-muted text-sm max-w-sm text-center">
          Agent is currently analyzing your codebase and security findings.
        </p>
      </div>
    );
  }

  if (loadingResults) {
    return (
      <div className="bg-background p-12 h-full flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-12 h-full flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (state === 'running') {
    return (
      <div className="p-12 h-full flex flex-col items-center justify-center min-h-[400px]">
        <Lottie
          animationData={runAnimation}
          loop
          className="w-72 h-72 mb-4 dark:invert"
        />
        <h3 className="text-xl font-semibold text-foreground mb-2">Scanning Project</h3>
        <p className="text-muted text-sm max-w-sm text-center">
          We are currently analyzing your codebase
        </p>
      </div>
    );
  }

  if (vulnStatus === 'not_initiated' && !results && state !== 'completed' && state !== 'error') {
    return (
      <div className="p-12 h-full flex flex-col items-center justify-center min-h-[400px]">
        <Lottie
          animationData={waitAnimation}
          loop
          className="w-72 h-72 mb-4 dark:hidden"
        />
        <Lottie
          animationData={waitDarkAnimation}
          loop
          className="w-72 h-72 mb-4 hidden dark:block dark:invert"
        />
        <h3 className="text-xl font-semibold text-foreground mb-2">Awaiting Scan</h3>
        <p className="text-muted text-sm max-w-sm text-center">
          Initiate a security scan from the dashboard.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/5 rounded-2xl border border-red-500/20 p-12 h-full flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
          <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Scan Failed</h3>
        <p className="text-red-400 text-sm bg-red-500/10 px-4 py-2 rounded-md">{error}</p>
      </div>
    );
  }

  if (!results) return null;

  const { supply_chain, code_security } = results;
  const hasVulnerabilities = supply_chain.length > 0 || code_security.length > 0;

  if (!hasVulnerabilities) {
    return null;
  }

  return (
    <div className="space-y-8">
      {supply_chain.length > 0 && (
        <SupplyChainTable vulnerabilities={supply_chain} />
      )}
      {code_security.length > 0 && (
        <div className="space-y-3">
          {code_security.map((group, i) => (
            <CWEAccordion key={`${group.cwe_id}-${group.severity}-${i}`} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
