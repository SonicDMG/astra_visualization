'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ResultsGrid from '@/components/ResultsGrid';
import RowDetailPanel from '@/components/RowDetailPanel';
import { docKey } from '@/lib/astra/schema';
import { loadLayout } from '@/lib/ui/columnLayout';
import {
  type PageSize,
  type QuerySpec,
  querySpecFromUrlParams,
  querySpecToUrlParams,
} from '@/lib/query/types';

type Doc = Record<string, unknown>;

interface CountInfo {
  count: number;
  isEstimate: boolean;
  isOver1000: boolean;
}

interface ExplorerStateProps {
  keyspace: string;
  collection: string;
}

const PAGE_SIZES: PageSize[] = [20, 50, 100];

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      style={{ color: 'var(--astra-muted)' }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function formatCount(info: CountInfo): string {
  if (info.isOver1000) return '1,000+';
  const n = info.count.toLocaleString('en-US');
  return info.isEstimate ? `~${n}` : `${n} documents`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json()) as T | { error: string };
  if (typeof data === 'object' && data !== null && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export default function ExplorerState({ keyspace, collection }: ExplorerStateProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [nextPageState, setNextPageState] = useState<string | null>(null);
  const [countInfo, setCountInfo] = useState<CountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  // $vector is excluded from fetches unless its column is made visible in the grid.
  const [showVector, setShowVector] = useState(
    () => loadLayout(keyspace, collection).columnVisibility.$vector === true,
  );
  // pageIndex -> pageState used to load that page, so Previous can step back.
  const pageStateHistory = useRef<Map<number, string | null>>(new Map());

  const paramsString = searchParams.toString();
  const spec: QuerySpec = useMemo(
    () => querySpecFromUrlParams(new URLSearchParams(paramsString), keyspace, collection),
    [paramsString, keyspace, collection],
  );
  const specQuery = querySpecToUrlParams(spec).toString();

  // Reset paging history when the collection changes.
  useEffect(() => {
    pageStateHistory.current = new Map();
  }, [keyspace, collection]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([
      fetchJson<{ documents: Doc[]; nextPageState: string | null }>(
        `/api/query?${specQuery}${showVector ? '&sv=1' : ''}`,
      ),
      fetchJson<CountInfo>(`/api/count?${specQuery}`),
    ])
      .then(([q, c]) => {
        if (cancelled) return;
        setDocuments(q.documents);
        setNextPageState(q.nextPageState);
        setCountInfo(c);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Keep previous documents visible; surface the error in a banner.
        setError(err instanceof Error ? err.message : 'Failed to load documents');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specQuery, refreshToken, showVector]);

  const updateSpec = useCallback(
    (next: QuerySpec) => {
      router.push(`/?${querySpecToUrlParams(next).toString()}`);
    },
    [router],
  );

  const goNext = () => {
    if (!nextPageState) return;
    pageStateHistory.current.set(spec.pageIndex, spec.pageState);
    updateSpec({ ...spec, pageState: nextPageState, pageIndex: spec.pageIndex + 1 });
  };

  const goPrevious = () => {
    if (spec.pageIndex === 0) return;
    const previous = pageStateHistory.current.get(spec.pageIndex - 1);
    // History is lost on reload; fall back to the first page.
    updateSpec({
      ...spec,
      pageState: previous ?? null,
      pageIndex: previous === undefined ? 0 : spec.pageIndex - 1,
    });
  };

  const changePageSize = (pageSize: PageSize) => {
    updateSpec({ ...spec, pageSize, pageState: null, pageIndex: 0 });
  };

  const handleRowClick = useCallback((doc: Doc) => {
    // Clicking the open row again closes the panel.
    setSelectedDoc((current) => (current !== null && docKey(current) === docKey(doc) ? null : doc));
  }, []);

  const buttonClass =
    'px-3 py-1 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed';
  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0 gap-2 p-4">
      {error && (
        <div
          role="alert"
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--astra-error)', color: 'var(--astra-error)' }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--astra-muted)' }}>
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={goPrevious}
          disabled={spec.pageIndex === 0 || loading}
        >
          Previous
        </button>
        <span>Page {spec.pageIndex + 1}</span>
        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={goNext}
          disabled={nextPageState === null || loading}
        >
          Next
        </button>

        <label className="flex items-center gap-1">
          Page size
          <select
            className="rounded border px-1 py-1"
            style={buttonStyle}
            value={spec.pageSize}
            onChange={(e) => changePageSize(Number(e.target.value) as PageSize)}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={() => setRefreshToken((t) => t + 1)}
          disabled={loading}
        >
          Refresh
        </button>

        {countInfo && <span>{formatCount(countInfo)}</span>}
        {loading && <Spinner />}
      </div>

      <ResultsGrid
        documents={documents}
        keyspace={keyspace}
        collection={collection}
        onRowClick={handleRowClick}
        selectedKey={selectedDoc ? docKey(selectedDoc) : null}
        onShowVectorChange={setShowVector}
      />

      {selectedDoc && (
        <RowDetailPanel
          key={docKey(selectedDoc)}
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}
