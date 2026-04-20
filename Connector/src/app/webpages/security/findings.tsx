'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useScan, type VulnStatus } from '@/lib/scan-context';
import LoadingSpinner from '@/components/loading-spinner';
import CountUp from '@/components/countup';
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
  onCleanScan?: () => void;
  onFindingsReady?: (ready: boolean) => void;
  onLoaded?: () => void;
}

type SeverityKey = 'critical' | 'high' | 'medium' | 'low';
type SeverityFilter = 'all' | SeverityKey;

const SEVERITY_META: Record<SeverityKey, {
  label: string;
  text: string;
  bar: string;
  softBg: string;
  softBorder: string;
  accent: string;
}> = {
  critical: {
    label: 'Critical',
    text: 'text-red-500',
    bar: 'bg-red-500',
    softBg: 'bg-red-500/10',
    softBorder: 'border-red-500/30',
    accent: 'bg-red-500',
  },
  high: {
    label: 'High',
    text: 'text-orange-500',
    bar: 'bg-orange-500',
    softBg: 'bg-orange-500/10',
    softBorder: 'border-orange-500/30',
    accent: 'bg-orange-500',
  },
  medium: {
    label: 'Medium',
    text: 'text-yellow-500',
    bar: 'bg-yellow-500',
    softBg: 'bg-yellow-500/10',
    softBorder: 'border-yellow-500/30',
    accent: 'bg-yellow-500',
  },
  low: {
    label: 'Low',
    text: 'text-blue-400',
    bar: 'bg-blue-400',
    softBg: 'bg-blue-400/10',
    softBorder: 'border-blue-400/30',
    accent: 'bg-blue-400',
  },
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normSeverity(s: string): SeverityKey {
  const k = s.toLowerCase();
  if (k === 'critical' || k === 'high' || k === 'medium' || k === 'low') return k;
  return 'low';
}

function SeverityBadge({ severity }: { severity: string }) {
  const k = normSeverity(severity);
  const meta = SEVERITY_META[k];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium text-sm ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.bar}`} />
      {meta.label}
    </span>
  );
}

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

// -------------------- Summary & filters --------------------

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function countSeverities(
  supply: SupplyChainVuln[],
  code: CWEGroup[],
): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const s of supply) counts[normSeverity(s.severity)] += 1;
  for (const g of code) counts[normSeverity(g.severity)] += g.count;
  return counts;
}

function SeverityStatCard({
  label,
  value,
  accent,
  duration,
  onEnd,
}: {
  label: string;
  value: number;
  accent: string;
  duration: number;
  onEnd: () => void;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-surface px-5 py-4 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${accent}`} />
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">{label}</div>
      <div className="text-3xl font-bold text-foreground mt-1 leading-none tabular-nums">
        <CountUp
          from={0}
          to={value}
          separator=","
          direction="up"
          duration={duration}
          className="count-up-text"
          delay={0}
          onEnd={onEnd}
        />
      </div>
    </div>
  );
}

function ReportHeader({
  counts,
  onCountingEnd,
}: {
  counts: SeverityCounts;
  onCountingEnd: () => void;
}) {
  const doneRef = useRef(0);
  const firedRef = useRef(false);

  const handleCardEnd = () => {
    doneRef.current += 1;
    if (doneRef.current >= 4 && !firedRef.current) {
      firedRef.current = true;
      onCountingEnd();
    }
  };

  const maxCount = Math.max(1, counts.critical, counts.high, counts.medium, counts.low);
  const minDuration = 0.25;
  const maxDuration = 1.8;
  const durationFor = (n: number) => {
    if (n <= 0) return minDuration;
    return minDuration + Math.sqrt(n / maxCount) * (maxDuration - minDuration);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">
            Security Analysis Report
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SeverityStatCard
          label="Critical"
          value={counts.critical}
          accent={SEVERITY_META.critical.bar}
          duration={durationFor(counts.critical)}
          onEnd={handleCardEnd}
        />
        <SeverityStatCard
          label="High"
          value={counts.high}
          accent={SEVERITY_META.high.bar}
          duration={durationFor(counts.high)}
          onEnd={handleCardEnd}
        />
        <SeverityStatCard
          label="Medium"
          value={counts.medium}
          accent={SEVERITY_META.medium.bar}
          duration={durationFor(counts.medium)}
          onEnd={handleCardEnd}
        />
        <SeverityStatCard
          label="Low"
          value={counts.low}
          accent={SEVERITY_META.low.bar}
          duration={durationFor(counts.low)}
          onEnd={handleCardEnd}
        />
      </div>
    </div>
  );
}

function SeverityFilterBar({
  filter,
  onChange,
  counts,
  total,
  search,
  onSearchChange,
}: {
  filter: SeverityFilter;
  onChange: (f: SeverityFilter) => void;
  counts: SeverityCounts;
  total: number;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const options: { key: SeverityFilter; label: string; n: number; accent?: string }[] = [
    { key: 'all', label: 'All severities', n: total },
    { key: 'critical', label: 'Critical', n: counts.critical, accent: SEVERITY_META.critical.bar },
    { key: 'high', label: 'High', n: counts.high, accent: SEVERITY_META.high.bar },
    { key: 'medium', label: 'Medium', n: counts.medium, accent: SEVERITY_META.medium.bar },
    { key: 'low', label: 'Low', n: counts.low, accent: SEVERITY_META.low.bar },
  ];

  const current = options.find((o) => o.key === filter) || options[0];

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-foreground hover:border-foreground/40 transition-colors"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{current.label}</span>
          <svg
            className={`w-3 h-3 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute z-20 mt-2 left-0 min-w-[200px] rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
          >
            {options.map((o) => {
              const active = o.key === filter;
              return (
                <button
                  key={o.key}
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                    active ? 'bg-foreground/5 text-foreground' : 'text-foreground hover:bg-border/30'
                  }`}
                >
                  <span className="flex-1 font-medium">{o.label}</span>
                  {active && (
                    <svg className="w-3.5 h-3.5 text-foreground ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative md:w-72">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-surface border border-border rounded-full pl-9 pr-3 py-2 text-sm text-foreground focus:outline-none focus:border-foreground/50 transition-colors"
        />
      </div>
    </div>
  );
}

// -------------------- Section & findings --------------------

function SectionHeader({
  title,
  count,
  tools,
}: {
  title: string;
  count: number;
  tools: string[];
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-foreground tracking-tight">{title}</h3>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted font-semibold hidden sm:inline">
          via {tools.join(' + ')}
        </span>
        <span className="inline-flex items-center justify-center min-w-[32px] h-7 px-2.5 rounded-full text-xs font-bold bg-foreground text-background tabular-nums">
          {count}
        </span>
      </div>
    </div>
  );
}

function EpssMeter({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-muted/60 text-xs italic">—</span>;
  }
  const pct = Math.max(0, Math.min(1, score));
  const pctStr = `${(pct * 100).toFixed(1)}%`;
  const barColor = pct >= 0.5 ? 'bg-red-500' : pct >= 0.1 ? 'bg-orange-500' : pct >= 0.01 ? 'bg-yellow-500' : 'bg-blue-400';
  return (
    <div className="inline-flex items-center gap-2 min-w-[90px]">
      <div className="relative w-16 h-1.5 rounded-full bg-border/50 overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 ${barColor}`} style={{ width: `${Math.max(pct * 100, 4)}%` }} />
      </div>
      <span className="tabular-nums text-xs text-foreground/80 font-mono">{pctStr}</span>
    </div>
  );
}

const supplyChainColumns: ColumnDef<SupplyChainVuln>[] = [
  {
    accessorKey: 'name',
    header: 'Package',
    cell: (info) => (
      <div className="flex flex-col leading-tight">
        <span className="font-medium text-foreground">{info.getValue<string>()}</span>
        <span className="font-mono text-[11px] text-muted mt-0.5">
          {info.row.original.type} · v{info.row.original.version}
        </span>
      </div>
    ),
  },
  {
    accessorKey: 'cve_id',
    header: 'CVE',
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
    cell: (info) => <EpssMeter score={info.getValue<number | null>()} />,
  },
  {
    accessorKey: 'fix_version',
    header: 'Remediation',
    meta: { align: 'right' as const },
    cell: (info) => {
      const val = info.getValue<string | null>();
      return val ? (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 font-medium text-emerald-500 text-xs">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          upgrade to <span className="font-mono">{val}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted/70 italic text-xs">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
          </svg>
          No fix available
        </span>
      );
    },
  },
];

function SupplyChainTable({ vulnerabilities }: { vulnerabilities: SupplyChainVuln[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'severity', desc: false },
  ]);

  const table = useReactTable({
    data: vulnerabilities,
    columns: supplyChainColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (vulnerabilities.length === 0) return null;

  return (
    <div className="overflow-x-auto w-full rounded-xl border border-border bg-surface">
      <table className="w-full text-sm text-left whitespace-nowrap">
        <thead className="text-muted text-[11px] uppercase tracking-[0.12em]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-border">
              {headerGroup.headers.map((header) => {
                const align = (header.column.columnDef.meta as { align?: string })?.align;
                return (
                  <th
                    key={header.id}
                    className={`py-3 px-4 font-semibold select-none ${
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
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-border/20 transition-colors">
              {row.getVisibleCells().map((cell) => {
                const align = (cell.column.columnDef.meta as { align?: string })?.align;
                return (
                  <td
                    key={cell.id}
                    className={`py-3.5 px-4 align-middle ${align === 'right' ? 'text-right' : ''}`}
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

function CodeOccurrence({ occ }: { occ: Occurrence }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${occ.filename}:${occ.line_number}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="px-5 py-4 border-b border-border/40 last:border-b-0">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <button
          onClick={handleCopy}
          className="group inline-flex items-center gap-2 bg-surface border border-border rounded-md px-2.5 py-1.5 text-xs hover:border-foreground/40 transition-colors min-w-0"
          title="Copy path"
        >
          <svg className="w-3.5 h-3.5 text-muted group-hover:text-foreground transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="font-mono text-foreground truncate">{occ.filename}</span>
          <span className="font-mono text-muted shrink-0">:{occ.line_number}</span>
          {copied ? (
            <span className="text-emerald-500 font-medium shrink-0">copied</span>
          ) : (
            <svg className="w-3 h-3 text-muted/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>

        {occ.documentation_url && (
          <a
            href={occ.documentation_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground border border-border hover:border-foreground/40 rounded-md px-2.5 py-1.5 transition-colors"
          >
            <span>Documentation</span>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>

      <div className="rounded-lg bg-[#0d1117] border border-gray-800 overflow-hidden flex">
        <div className="bg-[#161b22] text-gray-500 px-3 py-3 text-xs font-mono text-right select-none border-r border-gray-800 min-w-[48px]">
          <div className="text-amber-400/80">{occ.line_number}</div>
        </div>
        <div className="p-3 overflow-x-auto w-full relative">
          <div className="absolute inset-0 bg-red-500/5 pointer-events-none" />
          <pre className="text-xs font-mono text-gray-200 whitespace-pre relative">
            {occ.code_extract}
          </pre>
        </div>
      </div>
    </div>
  );
}

function CWEAccordion({ group }: { group: CWEGroup }) {
  const [expanded, setExpanded] = useState(false);
  const sev = normSeverity(group.severity);
  const meta = SEVERITY_META[sev];

  return (
    <div
      className={`relative rounded-xl border bg-surface overflow-hidden ${
        expanded ? `${meta.softBorder}` : 'border-border'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between pl-5 pr-4 py-3.5 text-left focus:outline-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <svg
            className={`w-4 h-4 text-muted shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <SeverityBadge severity={group.severity} />
          <span className="hidden sm:inline text-muted text-[11px] font-mono uppercase tracking-wider">
            CWE-{group.cwe_id}
          </span>
          <span className="font-semibold text-foreground text-sm truncate">
            {group.title}
          </span>
        </div>
        <span className={`shrink-0 ml-3 inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
          <span className="tabular-nums">{group.count}</span>
          <span className="font-normal opacity-70">occurrence{group.count === 1 ? '' : 's'}</span>
        </span>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-150 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border/60 bg-background/40">
            {group.occurrences.map((occ, i) => (
              <CodeOccurrence key={i} occ={occ} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------- Main component --------------------

export default function Findings({ projectId, remediating, onCleanScan, onFindingsReady, onLoaded }: FindingsProps) {
  const { getScanState, getCachedResults, setCachedResults } = useScan();
  const { state } = getScanState(projectId || '');

  const [vulnStatus, setVulnStatus] = useState<VulnStatus>('not_initiated');
  const [results, setResults] = useState<ScanResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');

  const [countingDone, setCountingDone] = useState(false);
  const [sectionsVisible, setSectionsVisible] = useState(false);

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

  useEffect(() => {
    if (!loading && !loadingResults) {
      onLoaded?.();
    }
  }, [loading, loadingResults]);

  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    setCountingDone(false);
    setSectionsVisible(false);
  }, [results]);

  useEffect(() => {
    if (!countingDone) return;
    const raf = requestAnimationFrame(() => setSectionsVisible(true));
    rafIdRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [countingDone]);

  // -------- derived filter state (hooks before early returns) --------

  const filtered = useMemo(() => {
    if (!results) return { supply_chain: [] as SupplyChainVuln[], code_security: [] as CWEGroup[] };
    const q = search.trim().toLowerCase();
    const supply = results.supply_chain.filter((v) => {
      if (severityFilter !== 'all' && normSeverity(v.severity) !== severityFilter) return false;
      if (!q) return true;
      return (
        v.name.toLowerCase().includes(q) ||
        v.cve_id.toLowerCase().includes(q) ||
        v.type.toLowerCase().includes(q) ||
        v.version.toLowerCase().includes(q)
      );
    });
    const code = results.code_security
      .map((g) => {
        if (severityFilter !== 'all' && normSeverity(g.severity) !== severityFilter) return null;
        if (!q) return g;
        const titleMatch = g.title.toLowerCase().includes(q) || g.cwe_id.toLowerCase().includes(q);
        const filteredOccs = g.occurrences.filter((o) =>
          o.filename.toLowerCase().includes(q) || o.code_extract.toLowerCase().includes(q),
        );
        if (titleMatch) return g;
        if (filteredOccs.length > 0) return { ...g, occurrences: filteredOccs, count: filteredOccs.length };
        return null;
      })
      .filter((g): g is CWEGroup => g !== null);
    return { supply_chain: supply, code_security: code };
  }, [results, severityFilter, search]);

  const totalCounts = useMemo(() => {
    if (!results) return { critical: 0, high: 0, medium: 0, low: 0 } as SeverityCounts;
    return countSeverities(results.supply_chain, results.code_security);
  }, [results]);

  const totalFindings = useMemo(
    () => totalCounts.critical + totalCounts.high + totalCounts.medium + totalCounts.low,
    [totalCounts],
  );

  const filteredTotal = filtered.supply_chain.length + filtered.code_security.reduce((s, g) => s + g.count, 0);

  // -------- loading / empty state UIs --------

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
  if (!hasVulnerabilities) return null;

  // -------- rendered report --------

  return (
    <div className="space-y-6 pb-8">
      <ReportHeader
        counts={totalCounts}
        onCountingEnd={() => setCountingDone(true)}
      />

      {(() => {
        const reveal = (delay: number): React.CSSProperties => ({
          opacity: sectionsVisible ? 1 : 0,
          transform: sectionsVisible ? 'none' : 'translateY(8px)',
          transition: `opacity 320ms ease ${delay}ms, transform 320ms ease ${delay}ms`,
        });

        let step = 0;
        const nextDelay = () => step++ * 150;

        const filterBarDelay = nextDelay();
        const scaHeaderDelay = filtered.supply_chain.length > 0 ? nextDelay() : 0;
        const scaTableDelay = filtered.supply_chain.length > 0 ? nextDelay() : 0;
        const codeHeaderDelay = filtered.code_security.length > 0 ? nextDelay() : 0;
        const codeBodyDelay = filtered.code_security.length > 0 ? nextDelay() : 0;

        return (
          <div
            className="space-y-6"
            style={{ pointerEvents: sectionsVisible ? 'auto' : 'none' }}
            aria-hidden={!sectionsVisible}
          >
            <div style={reveal(filterBarDelay)}>
              <SeverityFilterBar
                filter={severityFilter}
                onChange={setSeverityFilter}
                counts={totalCounts}
                total={totalFindings}
                search={search}
                onSearchChange={setSearch}
              />
            </div>

            {filteredTotal === 0 ? (
              <div
                style={reveal(150)}
                className="rounded-xl border border-dashed border-border bg-surface/50 px-6 py-12 text-center"
              >
                <div className="text-sm font-semibold text-foreground">No findings match your filters</div>
                <p className="text-xs text-muted mt-1">Try clearing the severity or search filter.</p>
                <button
                  onClick={() => { setSeverityFilter('all'); setSearch(''); }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-foreground/40 transition-colors"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <>
                {filtered.supply_chain.length > 0 && (
                  <section>
                    <div style={reveal(scaHeaderDelay)}>
                      <SectionHeader
                        title="Supply Chain"
                        count={filtered.supply_chain.length}
                        tools={['Grype', 'Syft']}
                      />
                    </div>
                    <div style={reveal(scaTableDelay)}>
                      <SupplyChainTable vulnerabilities={filtered.supply_chain} />
                    </div>
                  </section>
                )}

                {filtered.code_security.length > 0 && (
                  <section>
                    <div style={reveal(codeHeaderDelay)}>
                      <SectionHeader
                        title="Code Security"
                        count={filtered.code_security.reduce((s, g) => s + g.count, 0)}
                        tools={['Bearer']}
                      />
                    </div>
                    <div style={reveal(codeBodyDelay)} className="space-y-2.5">
                      {filtered.code_security.map((group, i) => (
                        <CWEAccordion
                          key={`${group.cwe_id}-${group.severity}-${i}`}
                          group={group}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}
