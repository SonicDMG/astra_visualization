'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import FilterBuilder from '@/components/FilterBuilder';
import ResultsGrid from '@/components/ResultsGrid';
import RowDetailPanel from '@/components/RowDetailPanel';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import { deriveFields, docKey } from '@/lib/astra/schema';
import { displayPath } from '@/lib/query/compile';
import { loadLayout } from '@/lib/ui/columnLayout';
import {
  type FilterTree,
  type PageSize,
  type QuerySpec,
  type SortKey,
  SORT_MAX_DOCUMENTS,
  defaultFilterTree,
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
/** Sort errors that leave the grid intact and offer "Clear sort". */
const SORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'OVERLOADED_SORT_ROW_LIMIT',
  'SORT_PAGE_BEYOND_LIMIT',
]);

class ApiRequestError extends Error {
  readonly errorCode: string | null;
  constructor(message: string, errorCode: string | null) {
    super(message);
    this.name = 'ApiRequestError';
    this.errorCode = errorCode;
  }
}

/** Page indexes (0-based) shown in the numbered pager: first page plus a window around the current one. */
function pageWindow(current: number, last: number): number[] {
  const pages = new Set<number>([0]);
  for (let p = Math.max(0, current - 2); p <= Math.min(last, current + 2); p++) pages.add(p);
  return [...pages].sort((a, b) => a - b);
}

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
  const data = (await res.json()) as T | { error: string; errorCode?: string };
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const { error, errorCode } = data as { error: unknown; errorCode?: unknown };
    throw new ApiRequestError(String(error), typeof errorCode === 'string' ? errorCode : null);
  }
  return data as T;
}

export default function ExplorerState({ keyspace, collection }: ExplorerStateProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [nextPageState, setNextPageState] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [countInfo, setCountInfo] = useState<CountInfo | null>(null);
  const [indexing, setIndexing] = useState<CollectionCapabilities['indexing']>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  // $vector is excluded from fetches unless its column is made visible in the grid.
  const [showVector, setShowVector] = useState(
    () => loadLayout(keyspace, collection).columnVisibility.$vector === true,
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
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

  // The collection's indexing options decide which columns are sortable.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ collections: { name: string; capabilities: CollectionCapabilities }[] }>(
      `/api/collections?keyspace=${encodeURIComponent(keyspace)}`,
    )
      .then((data) => {
        if (cancelled) return;
        const found = data.collections.find((c) => c.name === collection);
        setIndexing(found?.capabilities.indexing ?? null);
      })
      .catch(() => {
        // Non-fatal: without indexing info every scalar column stays sortable.
      });
    return () => {
      cancelled = true;
    };
  }, [keyspace, collection]);

  const fieldTypesParam = useMemo(() => {
    if (documents.length === 0) return '';
    const fields = deriveFields(documents);
    const map = Object.fromEntries(fields.map((f) => [f.escapedPath, f.type]));
    return `&ft=${encodeURIComponent(JSON.stringify(map))}`;
  }, [documents]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([
      fetchJson<{ documents: Doc[]; nextPageState: string | null; hasNextPage: boolean }>(
        `/api/query?${specQuery}${showVector ? '&sv=1' : ''}${fieldTypesParam}`,
      ),
      fetchJson<CountInfo>(`/api/count?${specQuery}${fieldTypesParam}`),
    ])
      .then(([q, c]) => {
        if (cancelled) return;
        setDocuments(q.documents);
        setNextPageState(q.nextPageState);
        setHasNextPage(q.hasNextPage);
        setCountInfo(c);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Keep previous documents visible; surface the error in a banner.
        setError({
          message: err instanceof Error ? err.message : 'Failed to load documents',
          code: err instanceof ApiRequestError ? err.errorCode : null,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [specQuery, refreshToken, showVector, fieldTypesParam]);

  const updateSpec = useCallback(
    (next: QuerySpec) => {
      router.push(`/?${querySpecToUrlParams(next).toString()}`);
    },
    [router],
  );

  const applyFilter = useCallback(
    (filter: FilterTree) => {
      updateSpec({ ...spec, filter, pageState: null, pageIndex: 0 });
    },
    [spec, updateSpec],
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

  // Any sort change returns to the first page.
  const changeSort = useCallback(
    (sort: SortKey[]) => {
      updateSpec({ ...spec, sort, pageState: null, pageIndex: 0 });
    },
    [spec, updateSpec],
  );

  const goToPage = (pageIndex: number) => {
    updateSpec({ ...spec, pageState: null, pageIndex });
  };

  const sorted = spec.sort.length > 0;
  const maxPages = Math.ceil(SORT_MAX_DOCUMENTS / spec.pageSize);
  // Count is an unfiltered estimate; never let it hide the page after the current one.
  const countPages = countInfo ? Math.ceil(countInfo.count / spec.pageSize) : maxPages;
  const lastPage = Math.min(
    maxPages,
    Math.max(countPages, spec.pageIndex + 1 + (hasNextPage ? 1 : 0)),
  ) - 1;
  const canNextSorted = hasNextPage && spec.pageIndex + 1 < maxPages;

  const filterCount = useMemo(() => {
    if (!spec.filter || !Array.isArray(spec.filter.children)) return 0;
    let count = 0;
    for (const child of spec.filter.children) {
      if (child.kind === 'condition') count++;
      else if (child.kind === 'group') count += child.children.length;
    }
    return count;
  }, [spec.filter]);

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
          className="flex items-center gap-3 rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--astra-error)', color: 'var(--astra-error)' }}
        >
          <span className="flex-1">{error.message}</span>
          {sorted && error.code !== null && SORT_ERROR_CODES.has(error.code) && (
            <button
              type="button"
              className={buttonClass}
              style={buttonStyle}
              onClick={() => changeSort([])}
            >
              Clear sort
            </button>
          )}
        </div>
      )}

      {sorted && (
        <div
          className="flex items-center gap-2 flex-wrap text-xs"
          style={{ color: 'var(--astra-muted)' }}
        >
          <span>Sorted by</span>
          {spec.sort.map((key, index) => (
            <span
              key={key.field}
              className="inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono"
              style={buttonStyle}
            >
              {spec.sort.length > 1 ? `${index + 1}. ` : ''}
              {displayPath(key.field)} {key.dir === 'asc' ? '▲' : '▼'}
              <button
                type="button"
                className="ml-1 rounded px-1"
                aria-label={`Remove sort on ${displayPath(key.field)}`}
                title={`Remove sort on ${displayPath(key.field)}`}
                onClick={() => changeSort(spec.sort.filter((k) => k.field !== key.field))}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className={buttonClass}
            style={buttonStyle}
            onClick={() => changeSort([])}
          >
            Clear sort
          </button>
        </div>
      )}

      {filterCount > 0 && !isFilterOpen && (
        <div
          className="flex items-center gap-2 flex-wrap text-xs"
          style={{ color: 'var(--astra-muted)' }}
        >
          <span>
            Filtered ({filterCount} condition{filterCount > 1 ? 's' : ''})
          </span>
          <button
            type="button"
            className={buttonClass}
            style={buttonStyle}
            onClick={() => setIsFilterOpen(true)}
          >
            Edit filter
          </button>
          <button
            type="button"
            className={buttonClass}
            style={buttonStyle}
            onClick={() => applyFilter(defaultFilterTree())}
          >
            Clear filter
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--astra-muted)' }}>
        <button
          type="button"
          className={buttonClass}
          style={{
            ...buttonStyle,
            ...(isFilterOpen || filterCount > 0
              ? { borderColor: 'var(--astra-accent)', color: 'var(--astra-text)' }
              : {}),
          }}
          onClick={() => setIsFilterOpen((prev) => !prev)}
        >
          Filters{filterCount > 0 ? ` (${filterCount})` : ''}
        </button>
        {sorted ? (
          <nav className="flex items-center gap-1" aria-label="Sorted results pages">
            <button
              type="button"
              className={buttonClass}
              style={buttonStyle}
              onClick={() => goToPage(spec.pageIndex - 1)}
              disabled={spec.pageIndex === 0 || loading}
            >
              Previous
            </button>
            {pageWindow(spec.pageIndex, lastPage).map((page, i, all) => (
              <span key={page} className="flex items-center gap-1">
                {i > 0 && page - all[i - 1] > 1 && <span aria-hidden="true">…</span>}
                <button
                  type="button"
                  className={buttonClass}
                  style={{
                    ...buttonStyle,
                    ...(page === spec.pageIndex
                      ? { background: 'var(--astra-accent)', color: '#fff' }
                      : {}),
                  }}
                  aria-current={page === spec.pageIndex ? 'page' : undefined}
                  onClick={() => goToPage(page)}
                  disabled={loading}
                >
                  {page + 1}
                </button>
              </span>
            ))}
            <button
              type="button"
              className={buttonClass}
              style={buttonStyle}
              onClick={() => goToPage(spec.pageIndex + 1)}
              disabled={!canNextSorted || loading}
            >
              Next
            </button>
            <label className="flex items-center gap-1 ml-2">
              Go to
              <input
                key={spec.pageIndex}
                type="number"
                min={1}
                max={maxPages}
                defaultValue={spec.pageIndex + 1}
                className="w-16 rounded border px-1 py-1"
                style={buttonStyle}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const n = Number.parseInt(e.currentTarget.value, 10);
                  if (Number.isNaN(n)) return;
                  goToPage(Math.min(maxPages, Math.max(1, n)) - 1);
                }}
              />
            </label>
            <span>of max {maxPages} (first {SORT_MAX_DOCUMENTS.toLocaleString('en-US')} documents)</span>
          </nav>
        ) : (
          <>
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
          </>
        )}

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

      {isFilterOpen && (
        <FilterBuilder
          key={JSON.stringify(spec.filter)}
          documents={documents}
          appliedFilter={spec.filter}
          indexing={indexing}
          onApply={applyFilter}
          onClose={() => setIsFilterOpen(false)}
        />
      )}

      <ResultsGrid
        documents={documents}
        keyspace={keyspace}
        collection={collection}
        sort={spec.sort}
        onSortChange={changeSort}
        indexing={indexing}
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
