// Pure module: no imports from Next.js, React, or the DOM.

export type SearchMode = 'browse' | 'semantic' | 'keyword' | 'hybrid';

export type PageSize = 20 | 50 | 100;

/** `field` is an escaped dotted path (see `lib/query/compile.ts`). */
export type SortKey = { field: string; dir: 'asc' | 'desc' };

/** Sorted queries page with skip/limit; the Data API only sorts the first 10,000 documents. */
export const SORT_MAX_DOCUMENTS = 10_000;

export type Combinator = 'and' | 'or';

export type ConditionOp =
  | 'eq'
  | 'ne'
  | 'exists'
  | 'notExists'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'dateBetween'
  | 'containsAny'
  | 'containsAll'
  | 'sizeIs'
  | 'isTrue'
  | 'isFalse';

export type FilterValue = string | number | boolean | null;

/**
 * A leaf filter condition.
 * Canonical representation: `field` is stored as the Data-API-escaped path
 * (`FieldInfo.escapedPath`, e.g. `address.city` or `my&.field`), matching `SortKey.field`.
 * Use `displayPath(condition.field)` when displaying to users.
 */
export type Condition = {
  kind: 'condition';
  field: string;
  op: ConditionOp;
  value?: FilterValue;
  value2?: FilterValue;
  values?: FilterValue[];
};

export type FilterGroup = {
  kind: 'group';
  combinator: Combinator;
  not: boolean;
  children: Condition[];
};

export type FilterTree = {
  combinator: Combinator;
  children: (Condition | FilterGroup)[];
};

/** Query text and/or an explicit query vector for the search modes. */
export type SearchInput = { text: string; vector: number[] | null };

/** Semantic mode: embed `searchInput.text` via `$vectorize`, or use `searchInput.vector` directly. */
export type SemanticSource = 'text' | 'vector';

/**
 * The `_id` of a "find similar" source document. Wider than `FilterValue` because
 * the Data API can return `_id` as an extended-JSON wrapper (`{ $uuid }`, `{ $objectId }`).
 */
export type DocId = string | number | { $uuid: string } | { $objectId: string };

export type QuerySpec = {
  keyspace: string;
  collection: string;
  searchMode: SearchMode;
  filter: FilterTree;
  /**
   * Ordered by priority; empty = unsorted. In browse mode this is sent to the Data API.
   * In search modes it is a LOCAL (browser-side) sort of the loaded results: the
   * gateway never sends it, and it does not trigger a refetch.
   */
  sort: SortKey[];
  searchInput: SearchInput;
  semanticSource: SemanticSource;
  /**
   * "Find similar": when set (semantic mode), the server looks up this document's
   * `$vector` and searches with it. Keeps the URL small versus embedding the vector.
   */
  similarTo: DocId | null;
  pageState: string | null; // for unsorted browse
  pageIndex: number; // for sorted/search paging
  pageSize: PageSize;
  searchLimit: number; // 1-1000, for search modes
};

const SEARCH_MODES: readonly SearchMode[] = ['browse', 'semantic', 'keyword', 'hybrid'];
const PAGE_SIZES: readonly PageSize[] = [20, 50, 100];

const DEFAULT_SEARCH_MODE: SearchMode = 'browse';
const DEFAULT_PAGE_SIZE: PageSize = 20;
export const DEFAULT_SEARCH_LIMIT = 50;
export const MIN_SEARCH_LIMIT = 1;
export const MAX_SEARCH_LIMIT = 1000;

/** Clamps to an integer in [MIN_SEARCH_LIMIT, MAX_SEARCH_LIMIT]; non-finite input yields the default. */
export function clampSearchLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(MAX_SEARCH_LIMIT, Math.max(MIN_SEARCH_LIMIT, Math.trunc(limit)));
}

export function isDocId(value: unknown): value is DocId {
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const inner = (value as Record<string, unknown>)[keys[0]];
  return (keys[0] === '$uuid' || keys[0] === '$objectId') && typeof inner === 'string';
}

/** Comma-joined numbers: compact and lossless (`String(n)` round-trips every finite double). */
export function vectorToParam(vector: number[]): string {
  // `String(-0)` is "0"; write `-0` explicitly so the round trip is lossless.
  return vector.map((n) => (Object.is(n, -0) ? '-0' : String(n))).join(',');
}

/** Lenient: any malformed or empty input yields `null`; never throws. */
export function vectorFromParam(value: string | null): number[] | null {
  if (!value) return null;
  const vector: number[] = [];
  for (const part of value.split(',')) {
    if (part.trim() === '') return null;
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    vector.push(n);
  }
  return vector.length > 0 ? vector : null;
}

export function defaultFilterTree(): FilterTree {
  return { combinator: 'and', children: [] };
}

export function defaultQuerySpec(keyspace: string, collection: string): QuerySpec {
  return {
    keyspace,
    collection,
    searchMode: DEFAULT_SEARCH_MODE,
    filter: defaultFilterTree(),
    sort: [],
    searchInput: { text: '', vector: null },
    semanticSource: 'text',
    similarTo: null,
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
  if (spec.searchInput.text !== '') params.set('q', spec.searchInput.text);
  if (spec.searchInput.vector && spec.searchInput.vector.length > 0) {
    params.set('qv', vectorToParam(spec.searchInput.vector));
  }
  if (spec.semanticSource !== 'text') params.set('ss', spec.semanticSource);
  if (spec.similarTo !== null) params.set('fs', JSON.stringify(spec.similarTo));
  if (spec.filter && spec.filter.children.length > 0) {
    const f = filterToParam(spec.filter);
    if (f) params.set('f', f);
  }
  if (spec.sort.length > 0) params.set('so', sortToParam(spec.sort));
  if (spec.pageState !== null) params.set('ps', spec.pageState);
  if (spec.pageIndex !== 0) params.set('pi', String(spec.pageIndex));
  if (spec.pageSize !== DEFAULT_PAGE_SIZE) params.set('pz', String(spec.pageSize));
  if (spec.searchLimit !== DEFAULT_SEARCH_LIMIT) params.set('sl', String(spec.searchLimit));
  return params;
}

/** `name:asc,age:desc`; field names are percent-encoded so `,` and `:` round-trip. */
function sortToParam(sort: SortKey[]): string {
  return sort.map((k) => `${encodeURIComponent(k.field)}:${k.dir}`).join(',');
}

function sortFromParam(value: string | null): SortKey[] {
  if (!value) return [];
  const keys: SortKey[] = [];
  for (const part of value.split(',')) {
    const colon = part.lastIndexOf(':');
    if (colon === -1) continue;
    const dir = part.slice(colon + 1);
    if (dir !== 'asc' && dir !== 'desc') continue;
    let field: string;
    try {
      field = decodeURIComponent(part.slice(0, colon));
    } catch {
      continue;
    }
    if (field === '' || keys.some((k) => k.field === field)) continue;
    keys.push({ field, dir });
  }
  return keys;
}

const VALID_OPS: ReadonlySet<ConditionOp> = new Set([
  'eq',
  'ne',
  'exists',
  'notExists',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'before',
  'after',
  'dateBetween',
  'containsAny',
  'containsAll',
  'sizeIs',
  'isTrue',
  'isFalse',
]);

function isFilterValue(v: unknown): v is FilterValue {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null;
}

function sanitizeCondition(raw: unknown): Condition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'condition') return null;
  if (typeof obj.field !== 'string' || obj.field.trim() === '') return null;
  if (typeof obj.op !== 'string' || !VALID_OPS.has(obj.op as ConditionOp)) return null;

  const cond: Condition = {
    kind: 'condition',
    field: obj.field,
    op: obj.op as ConditionOp,
  };

  if ('value' in obj && isFilterValue(obj.value)) cond.value = obj.value;
  if ('value2' in obj && isFilterValue(obj.value2)) cond.value2 = obj.value2;
  if ('values' in obj && Array.isArray(obj.values)) {
    cond.values = obj.values.filter(isFilterValue);
  }

  return cond;
}

function sanitizeGroup(raw: unknown): FilterGroup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== 'group') return null;
  const combinator: Combinator = obj.combinator === 'or' ? 'or' : 'and';
  const not = typeof obj.not === 'boolean' ? obj.not : false;
  if (!Array.isArray(obj.children)) return null;

  const children: Condition[] = [];
  for (const child of obj.children) {
    const valid = sanitizeCondition(child);
    if (valid) children.push(valid);
  }

  return {
    kind: 'group',
    combinator,
    not,
    children,
  };
}

/** Pure validator/sanitizer that drops malformed nodes. Never throws. */
export function sanitizeFilterTree(raw: unknown): FilterTree {
  if (typeof raw !== 'object' || raw === null) {
    return defaultFilterTree();
  }
  const obj = raw as Record<string, unknown>;
  const combinator: Combinator = obj.combinator === 'or' ? 'or' : 'and';
  if (!Array.isArray(obj.children)) {
    return { combinator, children: [] };
  }

  const children: (Condition | FilterGroup)[] = [];
  for (const child of obj.children) {
    if (typeof child === 'object' && child !== null) {
      const childObj = child as Record<string, unknown>;
      if (childObj.kind === 'group') {
        const group = sanitizeGroup(child);
        if (group) children.push(group);
      } else if (childObj.kind === 'condition') {
        const cond = sanitizeCondition(child);
        if (cond) children.push(cond);
      }
    }
  }

  return {
    combinator,
    children,
  };
}

export function filterToParam(filter: FilterTree): string {
  if (!filter || !Array.isArray(filter.children) || filter.children.length === 0) {
    return '';
  }
  return encodeURIComponent(JSON.stringify(filter));
}

export function filterFromParam(value: string | null): FilterTree {
  if (!value) return defaultFilterTree();
  try {
    let jsonStr: string;
    try {
      jsonStr = decodeURIComponent(value);
    } catch {
      jsonStr = value;
    }
    const parsed: unknown = JSON.parse(jsonStr);
    return sanitizeFilterTree(parsed);
  } catch {
    return defaultFilterTree();
  }
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

  spec.searchInput = { text: params.get('q') ?? '', vector: vectorFromParam(params.get('qv')) };
  if (params.get('ss') === 'vector') spec.semanticSource = 'vector';
  const fs = params.get('fs');
  if (fs) {
    try {
      const parsed: unknown = JSON.parse(fs);
      if (isDocId(parsed)) spec.similarTo = parsed;
    } catch {
      // Lenient: a malformed `fs` is ignored.
    }
  }

  spec.filter = filterFromParam(params.get('f'));
  spec.sort = sortFromParam(params.get('so'));

  const ps = params.get('ps');
  if (ps) spec.pageState = ps;

  const pi = parseIntParam(params.get('pi'));
  if (pi !== null) spec.pageIndex = pi;

  const pz = parseIntParam(params.get('pz'));
  const pageSize = PAGE_SIZES.find((s) => s === pz);
  if (pageSize) spec.pageSize = pageSize;

  const sl = parseIntParam(params.get('sl'));
  if (sl !== null) spec.searchLimit = clampSearchLimit(sl);

  return spec;
}
