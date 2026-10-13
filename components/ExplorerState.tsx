'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import FilterBuilder from '@/components/FilterBuilder';
import ResultsGrid from '@/components/ResultsGrid';
import RowDetailPanel from '@/components/RowDetailPanel';
import LiveTracePanel from '@/components/LiveTracePanel';
import SearchBar, { type SearchPatch } from '@/components/SearchBar';
import type { CollectionCapabilities } from '@/lib/astra/gateway';
import { useTrace } from '@/lib/trace/TraceContext';
import type { ServerTraceEvent } from '@/lib/trace/types';
import { deriveFields, docKey, unwrapScalar } from '@/lib/astra/schema';
import { displayPath, sortDocumentsLocally } from '@/lib/query/compile';
import { loadLayout } from '@/lib/ui/columnLayout';
import {
  type Condition,
  type FilterTree,
  type FilterValue,
  type PageSize,
  type QuerySpec,
  type SortKey,
  SORT_MAX_DOCUMENTS,
  defaultFilterTree,
  isDocId,
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
const NO_DOCUMENTS: Doc[] = [];
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
  const [capabilities, setCapabilities] = useState<CollectionCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  // Field to reveal in the detail panel after a cell click (new object per click).
  const [focusField, setFocusField] = useState<{ field: string } | null>(null);
  // $vector is excluded from fetches unless its column is made visible in the grid.
  const [showVector, setShowVector] = useState(
    () => loadLayout(keyspace, collection).columnVisibility.$vector === true,
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  // pageIndex -> pageState used to load that page, so Previous can step back.
  const pageStateHistory = useRef<Map<number, string | null>>(new Map());
  const { isPanelOpen, startRun, emitStep, finishRun } = useTrace();
  // Identifies the sort/page/refresh a trace run was started for, so refetches caused by anything
  // else (e.g. field types arriving) continue that run instead of starting another.
  const lastTracedRunKeyRef = useRef<string | null>(null);

  const paramsString = searchParams.toString();
  const spec: QuerySpec = useMemo(
    () => querySpecFromUrlParams(new URLSearchParams(paramsString), keyspace, collection),
    [paramsString, keyspace, collection],
  );
  const isSearch = spec.searchMode !== 'browse';
  const indexing = capabilities?.indexing ?? null;
  // In search modes the sort is LOCAL (applied in the browser to the loaded results), so it,
  // and the unused paging fields, are left out of the request: changing them never refetches.
  const specQuery = useMemo(
    () =>
      querySpecToUrlParams(
        isSearch ? { ...spec, sort: [], pageState: null, pageIndex: 0 } : spec,
      ).toString(),
    [spec, isSearch],
  );

  // Reset paging history when the collection changes.
  useEffect(() => {
    pageStateHistory.current = new Map();
  }, [keyspace, collection]);

  // Capabilities decide which search modes are offered and which columns are sortable.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ collections: { name: string; capabilities: CollectionCapabilities }[] }>(
      `/api/collections?keyspace=${encodeURIComponent(keyspace)}`,
    )
      .then((data) => {
        if (cancelled) return;
        const found = data.collections.find((c) => c.name === collection);
        setCapabilities(found?.capabilities ?? null);
      })
      .catch(() => {
        // Non-fatal: only Browse is offered, and every scalar column stays sortable.
      });
    return () => {
      cancelled = true;
    };
  }, [keyspace, collection]);

  const hasFilter = spec.filter.children.length > 0;
  const fieldTypesParam = useMemo(() => {
    // Field types only matter for filters. Skipping them otherwise avoids the refetch they
    // trigger, which for a search would be a second embedding/rerank call.
    if (documents.length === 0 || (isSearch && !hasFilter)) return '';
    const fields = deriveFields(documents);
    const map = Object.fromEntries(fields.map((f) => [f.escapedPath, f.type]));
    return `&ft=${encodeURIComponent(JSON.stringify(map))}`;
  }, [documents, isSearch, hasFilter]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const traceQueryParam = isPanelOpen ? '&trace=1' : '';

    const runKey = `${JSON.stringify(spec.sort)}|${spec.pageIndex}|${refreshToken}`;
    if (isPanelOpen && !isSearch && spec.sort.length > 0 && lastTracedRunKeyRef.current !== runKey) {
      lastTracedRunKeyRef.current = runKey;
      startRun({
        sortSpec: spec.sort.map((k) => ({ field: k.field, dir: k.dir })),
        searchMode: 'browse',
      });
      emitStep({
        nodeId: 'change',
        status: 'ok',
        label: spec.pageIndex > 0 ? `Page navigation (p=${spec.pageIndex + 1})` : 'Sorted query',
        detail: spec.sort.map((s) => `${s.field} ${s.dir}`).join(', '),
      });
    }

    const queryRequest = fetchJson<{
      documents: Doc[];
      nextPageState: string | null;
      hasNextPage: boolean;
      trace?: ServerTraceEvent[];
    }>(`/api/query?${specQuery}${showVector ? '&sv=1' : ''}${fieldTypesParam}${traceQueryParam}`);
    // Search modes never count: the count is the number of returned results.
    const countRequest: Promise<CountInfo> = isSearch
      ? queryRequest.then((q) => ({
          count: q.documents.length,
          isEstimate: false,
          isOver1000: false,
        }))
      : fetchJson<CountInfo>(`/api/count?${specQuery}${fieldTypesParam}`);
    Promise.all([queryRequest, countRequest])
      .then(([q, c]) => {
        if (cancelled) return;
        setDocuments(q.documents);
        setNextPageState(q.nextPageState);
        setHasNextPage(q.hasNextPage);
        setCountInfo(c);
        setError(null);

        if (isPanelOpen && !isSearch && spec.sort.length > 0) {
          emitStep({
            nodeId: 'mode',
            edgeId: 'change-mode',
            status: 'ok',
            label: 'Browse mode',
          });

          if (q.trace && q.trace.length > 0) {
            const compileEvt = q.trace.find((t) => t.node === 'compile');
            if (compileEvt) {
              emitStep({
                nodeId: 'compile',
                edgeId: 'mode-compile',
                status: 'ok',
                label: 'compileSort (Server)',
                detail: `Keys: ${spec.sort.length}`,
                elapsedMs: compileEvt.ms,
              });
            }
            const findEvt = q.trace.find((t) => t.node === 'find');
            if (findEvt) {
              emitStep({
                nodeId: 'find',
                edgeId: 'compile-find',
                status: 'ok',
                label: 'Astra find (Server)',
                detail: `Returned ${q.documents.length} docs`,
                elapsedMs: findEvt.ms,
              });
            }
          } else {
            emitStep({
              nodeId: 'compile',
              edgeId: 'mode-compile',
              status: 'ok',
              label: 'compileSort (Server)',
            });
            emitStep({
              nodeId: 'find',
              edgeId: 'compile-find',
              status: 'ok',
              label: 'Astra find (Server)',
              detail: `Returned ${q.documents.length} docs`,
            });
          }

          emitStep({
            nodeId: 'render',
            edgeId: 'find-render',
            status: 'ok',
            label: 'Grid renders page',
            detail: `${q.documents.length} rows rendered`,
          });
          finishRun('ok');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const errMsg = err instanceof Error ? err.message : 'Failed to load documents';
        const errCode = err instanceof ApiRequestError ? err.errorCode : null;
        setError({
          message: errMsg,
          code: errCode,
        });

        if (isPanelOpen && !isSearch && spec.sort.length > 0) {
          emitStep({
            nodeId: 'mode',
            edgeId: 'change-mode',
            status: 'ok',
            label: 'Browse mode',
          });
          emitStep({
            nodeId: 'compile',
            edgeId: 'mode-compile',
            status: 'ok',
            label: 'compileSort (Server)',
          });
          emitStep({
            nodeId: 'find',
            edgeId: 'compile-find',
            status: 'ok',
            label: 'Astra find (Server)',
          });
          emitStep({
            nodeId: 'errors',
            edgeId: 'find-errors',
            status: 'error',
            label: 'Error banner',
            detail: errCode ?? errMsg,
          });
          finishRun('error', errCode ?? errMsg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    specQuery,
    isSearch,
    refreshToken,
    showVector,
    fieldTypesParam,
    isPanelOpen,
    spec.sort,
    spec.pageIndex,
    startRun,
    emitStep,
    finishRun,
  ]);

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

  // Entering or leaving a search mode resets paging and clears the sort.
  const applySearch = useCallback(
    (patch: SearchPatch) => {
      updateSpec({ ...spec, ...patch, sort: [], pageState: null, pageIndex: 0 });
    },
    [spec, updateSpec],
  );

  // "Find similar": the server resolves the source document's `$vector`, keeping the URL small.
  const findSimilar = useCallback(
    (doc: Doc) => {
      if (!isDocId(doc._id)) return;
      setSelectedDoc(null);
      updateSpec({
        ...spec,
        searchMode: 'semantic',
        semanticSource: 'vector',
        searchInput: { text: '', vector: null },
        similarTo: doc._id,
        sort: [],
        pageState: null,
        pageIndex: 0,
      });
    },
    [spec, updateSpec],
  );

  const goToPage = (pageIndex: number) => {
    updateSpec({ ...spec, pageState: null, pageIndex });
  };

  const sorted = spec.sort.length > 0;
  // Search modes sort the loaded results in the browser; a failed search shows no stale rows.
  const shownDocuments = useMemo(() => {
    if (!isSearch) return documents;
    if (error) return NO_DOCUMENTS;
    return sortDocumentsLocally(documents, spec.sort);
  }, [documents, isSearch, error, spec.sort]);

  const lastLocalSortRef = useRef<string>('');
  useEffect(() => {
    if (!isSearch || !isPanelOpen || spec.sort.length === 0 || error) return;
    const sortKey = JSON.stringify(spec.sort);
    if (lastLocalSortRef.current === sortKey) return;
    lastLocalSortRef.current = sortKey;

    emitStep({
      nodeId: 'mode',
      edgeId: 'change-mode',
      status: 'ok',
      label: 'Ranked search mode',
    });
    emitStep({
      nodeId: 'local',
      edgeId: 'mode-local',
      status: 'ok',
      label: `Local sort (${documents.length} docs)`,
      detail: 'In-memory client sort (no refetch)',
    });
    emitStep({
      nodeId: 'render',
      edgeId: 'local-render',
      status: 'ok',
      label: 'Grid renders page',
    });
    finishRun('ok');
  }, [isSearch, isPanelOpen, spec.sort, error, documents.length, emitStep, finishRun]);
  const canFindSimilar = capabilities?.hasVector === true;
  const searchBarKey = [
    spec.searchMode,
    spec.searchInput.text,
    spec.searchInput.vector?.length ?? 0,
    spec.semanticSource,
    spec.searchLimit,
    spec.similarTo === null ? 0 : 1,
    capabilities === null ? 0 : 1,
  ].join('|');
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
    setFocusField(null);
    setSelectedDoc((current) => (current !== null && docKey(current) === docKey(doc) ? null : doc));
  }, []);

  // Clicking a cell opens the row (never closes it) and reveals that column's field.
  const handleCellClick = useCallback((doc: Doc, field: string) => {
    setSelectedDoc(doc);
    setFocusField({ field });
  }, []);

  const handleQuickFilter = useCallback(
    (field: string, value: FilterValue) => {
      const newCondition: Condition = { kind: 'condition', field, op: 'eq', value };
      const newFilter: FilterTree = {
        ...spec.filter,
        children: [...spec.filter.children, newCondition],
      };
      applyFilter(newFilter);
      setIsFilterOpen(true);
    },
    [spec.filter, applyFilter],
  );

  const buttonClass =
    'px-3 py-1 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed';
  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] min-h-0">
      <LiveTracePanel />
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-2 p-4">
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
          {isSearch && (
            <span
              className="rounded border px-1.5 py-0.5"
              style={{ borderColor: 'var(--astra-accent)', color: 'var(--astra-accent)' }}
              title="Search results are sorted in your browser; the server order is relevance"
            >
              local
            </span>
          )}
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
            {isSearch ? 'Restore relevance order' : 'Clear sort'}
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

      <SearchBar
        key={searchBarKey}
        spec={spec}
        capabilities={capabilities}
        onApply={applySearch}
      />

      {spec.similarTo !== null && (
        <div
          className="flex items-center gap-2 flex-wrap text-xs"
          style={{ color: 'var(--astra-muted)' }}
        >
          <span>Similar to</span>
          <span
            className="rounded border px-2 py-0.5 font-mono"
            style={buttonStyle}
            title={JSON.stringify(spec.similarTo)}
          >
            {String(unwrapScalar(spec.similarTo))}
          </span>
          <button
            type="button"
            className={buttonClass}
            style={buttonStyle}
            onClick={() =>
              applySearch({
                searchMode: 'browse',
                searchInput: { text: '', vector: null },
                semanticSource: spec.semanticSource,
                similarTo: null,
                searchLimit: spec.searchLimit,
              })
            }
          >
            Back to browse
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
        {isSearch ? (
          <span>
            Showing {shownDocuments.length.toLocaleString('en-US')}{' '}
            {shownDocuments.length === 1 ? 'result' : 'results'}
          </span>
        ) : sorted ? (
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

        {!isSearch && (
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
        )}

        <button
          type="button"
          className={buttonClass}
          style={buttonStyle}
          onClick={() => setRefreshToken((t) => t + 1)}
          disabled={loading}
        >
          Refresh
        </button>

        {countInfo && !isSearch && <span>{formatCount(countInfo)}</span>}
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
        documents={shownDocuments}
        keyspace={keyspace}
        collection={collection}
        sort={spec.sort}
        onSortChange={changeSort}
        indexing={indexing}
        onRowClick={handleRowClick}
        onCellClick={handleCellClick}
        selectedKey={selectedDoc ? docKey(selectedDoc) : null}
        onShowVectorChange={setShowVector}
        searchMode={spec.searchMode}
        onFindSimilar={canFindSimilar ? findSimilar : undefined}
      />
        </div>

        {selectedDoc && (
          <RowDetailPanel
            key={docKey(selectedDoc)}
            doc={selectedDoc}
            onClose={() => setSelectedDoc(null)}
            onFindSimilar={canFindSimilar ? findSimilar : undefined}
            onQuickFilter={handleQuickFilter}
            indexing={indexing}
            focus={focusField}
          />
        )}
      </div>
    </div>
  );
}
