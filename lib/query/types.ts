// Pure module: no imports from Next.js, React, or the DOM.

export type SearchMode = 'browse' | 'semantic' | 'keyword' | 'hybrid';

export type PageSize = 20 | 50 | 100;

export type QuerySpec = {
  keyspace: string;
  collection: string;
  searchMode: SearchMode;
  // filter: FilterTree — add in Phase 6
  // sort: SortSpec[] — add in Phase 5
  // searchInput: SearchInput — add in Phase 7
  pageState: string | null; // for unsorted browse
  pageIndex: number; // for sorted/search paging
  pageSize: PageSize;
  searchLimit: number; // 10-1000, for search modes
};

const SEARCH_MODES: readonly SearchMode[] = ['browse', 'semantic', 'keyword', 'hybrid'];
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

const DEFAULT_SEARCH_MODE: SearchMode = 'browse';
const DEFAULT_PAGE_SIZE: PageSize = 20;
const DEFAULT_SEARCH_LIMIT = 100;
const MIN_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 1000;

export function defaultQuerySpec(keyspace: string, collection: string): QuerySpec {
  return {
    keyspace,
    collection,
    searchMode: DEFAULT_SEARCH_MODE,
    pageState: null,
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    searchLimit: DEFAULT_SEARCH_LIMIT,
  };
}

/**
 * Serializes a QuerySpec to URL params. `keyspace` and `collection` are
 * written under their full names; everything else uses compact keys and is
 * omitted when it equals the default.
 */
export function querySpecToUrlParams(spec: QuerySpec): URLSearchParams {
  const params = new URLSearchParams();
  params.set('keyspace', spec.keyspace);
  params.set('collection', spec.collection);
  if (spec.searchMode !== DEFAULT_SEARCH_MODE) params.set('sm', spec.searchMode);
  if (spec.pageState !== null) params.set('ps', spec.pageState);
  if (spec.pageIndex !== 0) params.set('pi', String(spec.pageIndex));
  if (spec.pageSize !== DEFAULT_PAGE_SIZE) params.set('pz', String(spec.pageSize));
  if (spec.searchLimit !== DEFAULT_SEARCH_LIMIT) params.set('sl', String(spec.searchLimit));
  return params;
}

function parseIntParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

/**
 * Parses a QuerySpec from URL params. `keyspace` and `collection` are passed
 * explicitly; invalid or missing values fall back to defaults.
 */
export function querySpecFromUrlParams(
  params: URLSearchParams,
  keyspace: string,
  collection: string,
): QuerySpec {
  const spec = defaultQuerySpec(keyspace, collection);

  const sm = params.get('sm');
  const searchMode = SEARCH_MODES.find((m) => m === sm);
  if (searchMode) spec.searchMode = searchMode;

  const ps = params.get('ps');
  if (ps) spec.pageState = ps;

  const pi = parseIntParam(params.get('pi'));
  if (pi !== null) spec.pageIndex = pi;

  const pz = parseIntParam(params.get('pz'));
  const pageSize = PAGE_SIZES.find((s) => s === pz);
  if (pageSize) spec.pageSize = pageSize;

  const sl = parseIntParam(params.get('sl'));
  if (sl !== null) {
    spec.searchLimit = Math.min(MAX_SEARCH_LIMIT, Math.max(MIN_SEARCH_LIMIT, sl));
  }

  return spec;
}
