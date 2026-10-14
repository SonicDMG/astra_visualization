/**
 * Schema inspector — pure, side-effect-free utilities for deriving
 * collection capabilities from raw Data API collection options.
 */

import type { CollectionDefinition, CollectionCapabilities } from './gateway';
import {
  escapeFieldSegment,
  splitEscapedPath,
  unescapeFieldSegment,
} from '@/lib/query/compile';

/**
 * Vectorize providers that need a user-supplied API key. The key is either stored in
 * Astra KMS (`service.authentication.providerKey`) or sent per request in a header
 * (`x-embedding-api-key`). Providers that need no key (e.g. NVIDIA, which Astra hosts)
 * are deliberately absent. Kept small and conservative: unknown providers are never blocked.
 */
const KEY_REQUIRED_VECTORIZE_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'azureOpenAI',
  'cohere',
  'jinaAI',
  'voyageAI',
  'mistral',
  'huggingface',
]);

/**
 * Best-effort heuristic: semantic TEXT search can't work when the collection's vectorize
 * provider needs a key, the collection stores none (`service.authentication` absent or
 * empty), and this app never sends an embedding-key header. Only true for providers in
 * {@link KEY_REQUIRED_VECTORIZE_PROVIDERS}.
 */
export function vectorizeRequiresHeaderKey(
  provider: string | null | undefined,
  authentication: Record<string, unknown> | null | undefined,
): boolean {
  if (!provider || !KEY_REQUIRED_VECTORIZE_PROVIDERS.has(provider)) return false;
  return !authentication || Object.keys(authentication).length === 0;
}

/**
 * Derive a normalized capability summary from raw collection definition.
 * This function is pure — no I/O, no env access, no side effects.
 */
export function parseCapabilities(definition: CollectionDefinition): CollectionCapabilities {
  const vector = definition.vector;
  const vectorService = vector?.service;
  const rerank = definition.rerank;

  return {
    hasVector: !!vector,
    vectorDimension: vector?.dimension ?? null,
    vectorMetric: vector?.metric ?? null,
    vectorizeProvider: vectorService?.provider ?? null,
    vectorizeModel: vectorService?.modelName ?? null,
    vectorizeNeedsKey: vectorizeRequiresHeaderKey(
      vectorService?.provider,
      vectorService?.authentication,
    ),
    hasLexical: !!definition.lexical?.enabled,
    hasRerank: !!rerank?.enabled,
    indexing: parseIndexing(definition.indexing),
  };
}

/** Normalizes the collection's `indexing` option to `{ allow } | { deny } | null`. */
function parseIndexing(indexing: unknown): CollectionCapabilities['indexing'] {
  if (typeof indexing !== 'object' || indexing === null) return null;
  const { allow, deny } = indexing as { allow?: unknown; deny?: unknown };
  const strings = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : null;
  const denyList = strings(deny);
  if (denyList) return { deny: denyList };
  const allowList = strings(allow);
  if (allowList) return { allow: allowList };
  return null;
}

/**
 * Whether a field is indexed (and therefore sortable/filterable) given the
 * collection's `indexing` options. `path` is an escaped dotted path.
 *  - `deny` set: indexed unless the field or a parent path is denied (`"*"` denies all).
 *  - `allow` set: indexed only if the field or a parent path is allowed (`"*"` allows all).
 *  - neither: indexed.
 */
export function isFieldIndexed(
  path: string,
  indexing: CollectionCapabilities['indexing'] | undefined,
): boolean {
  if (!indexing) return true;
  const segments = splitEscapedPath(path);
  const ancestors = new Set<string>(['*']);
  for (let i = 1; i <= segments.length; i++) ancestors.add(segments.slice(0, i).join('.'));
  if ('deny' in indexing) return !indexing.deny.some((p) => ancestors.has(p));
  return indexing.allow.some((p) => ancestors.has(p));
}

/**
 * Human-readable label for the vector index (e.g. "1024d cosine").
 * Returns null when the collection has no vector index.
 */
export function vectorLabel(caps: CollectionCapabilities): string | null {
  if (!caps.hasVector) return null;
  const dim = caps.vectorDimension ?? '?';
  const metric = caps.vectorMetric ?? 'unknown';
  return `${dim}d ${metric}`;
}

/**
 * Human-readable label for the vectorize integration (e.g. "NVIDIA/nv-embedqa-e5-v5").
 * Returns null when vectorize is not configured.
 */
export function vectorizeLabel(caps: CollectionCapabilities): string | null {
  if (!caps.vectorizeProvider || !caps.vectorizeModel) return null;
  return `${caps.vectorizeProvider}/${caps.vectorizeModel}`;
}

// ─── Field inference ────────────────────────────────────────────────────────

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'isoDate'
  | 'dollarDate'
  | 'mixed';

export type FieldInfo = {
  /** Dotted path as shown to users, e.g. `address.city`. */
  path: string;
  /**
   * Dotted path where `.` and `&` inside key names are escaped the Data API way
   * (`.` -> `&.`, `&` -> `&&`; see `lib/query/compile.ts`). Used for filter/sort.
   */
  escapedPath: string;
  type: FieldType;
  isNested: boolean;
};

/** Maximum number of path segments walked (`a.b.c`). */
const MAX_FIELD_DEPTH = 3;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extended-JSON date: `{ $date: <epoch millis> }`. */
export function isDollarDate(value: unknown): value is { $date: number } {
  return isPlainObject(value) && typeof value.$date === 'number';
}

/** Extended-JSON scalar wrapper such as `{ $uuid: "…" }`; treated as an opaque leaf. */
function isOpaqueWrapper(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0].startsWith('$');
}

/**
 * Unwraps extended-JSON scalars (`{ $uuid: "…" }`, `{ $objectId: "…" }`) to their
 * inner primitive for display. Any other value is returned unchanged.
 */
export function unwrapScalar(value: unknown): unknown {
  if (isPlainObject(value) && isOpaqueWrapper(value)) {
    const inner = Object.values(value)[0];
    if (typeof inner === 'string' || typeof inner === 'number' || typeof inner === 'boolean') {
      return inner;
    }
  }
  return value;
}

export function inferType(value: unknown): FieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return ISO_DATE_PATTERN.test(value) ? 'isoDate' : 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (isDollarDate(value)) return 'dollarDate';
  // `{ $uuid: "…" }`-style wrappers are scalars, typed by their inner value.
  const scalar = unwrapScalar(value);
  if (scalar !== value) return inferType(scalar);
  return 'object';
}

/** Reads a value from a document using a dotted path produced by `escapedPath`. */
export function getByEscapedPath(doc: Record<string, unknown>, escapedPath: string): unknown {
  let current: unknown = doc;
  for (const segment of splitEscapedPath(escapedPath)) {
    if (!isPlainObject(current)) return undefined;
    current = current[unescapeFieldSegment(segment)];
  }
  return current;
}

/**
 * Derives field metadata from a set of documents. Nested object keys are
 * included as dotted paths up to {@link MAX_FIELD_DEPTH} levels deep.
 * Result is sorted with `_id` first, then alphabetically by path.
 */
export function deriveFields(documents: Record<string, unknown>[]): FieldInfo[] {
  const seen = new Map<string, { path: string; types: Set<FieldType>; isNested: boolean }>();

  const visit = (segments: string[], value: unknown): void => {
    const escapedPath = segments.map(escapeFieldSegment).join('.');
    const type = inferType(value);
    const entry = seen.get(escapedPath) ?? {
      path: segments.join('.'),
      types: new Set<FieldType>(),
      isNested: segments.length > 1,
    };
    entry.types.add(type);
    seen.set(escapedPath, entry);

    if (type === 'object' && segments.length < MAX_FIELD_DEPTH && isPlainObject(value)) {
      if (isOpaqueWrapper(value)) return;
      for (const [key, child] of Object.entries(value)) visit([...segments, key], child);
    }
  };

  for (const doc of documents) {
    for (const [key, value] of Object.entries(doc)) visit([key], value);
  }

  const fields: FieldInfo[] = [];
  for (const [escapedPath, entry] of seen) {
    const types = new Set(entry.types);
    // A null alongside real values is just a missing value, not a type conflict.
    if (types.size > 1) types.delete('null');
    const type: FieldType = types.size === 1 ? [...types][0] : 'mixed';
    fields.push({ path: entry.path, escapedPath, type, isNested: entry.isNested });
  }

  return fields.sort((a, b) => {
    if (a.escapedPath === '_id') return -1;
    if (b.escapedPath === '_id') return 1;
    if (a.path < b.path) return -1;
    return a.path > b.path ? 1 : 0;
  });
}

/**
 * Checks whether a given field path can be edited.
 * In Astra DB Data API:
 * - `_id` is an immutable primary key that cannot be modified after document creation.
 * - `$similarity` and other `$`-prefixed fields are synthetic query-time values and cannot be persisted.
 */
export function isFieldEditable(escapedPath: string): { editable: boolean; reason?: string } {
  if (escapedPath === '_id' || escapedPath.startsWith('_id.') || escapedPath.startsWith('_id/')) {
    return {
      editable: false,
      reason: 'The _id field is an immutable primary key in Astra DB and cannot be edited.',
    };
  }
  const topLevelKey = escapedPath.split('.')[0].split('/')[0];
  if (topLevelKey.startsWith('$')) {
    return {
      editable: false,
      reason: `$-prefixed fields are synthetic values computed by Astra DB and cannot be edited.`,
    };
  }
  return { editable: true };
}

/**
 * Returns a new document with the value at `escapedPath` updated.
 * Handles nested objects immutably.
 */
export function setByEscapedPath(
  doc: Record<string, unknown>,
  escapedPath: string,
  value: unknown,
): Record<string, unknown> {
  const segments = splitEscapedPath(escapedPath).map(unescapeFieldSegment);
  if (segments.length === 0) return doc;

  function updateRec(current: unknown, index: number): unknown {
    if (index === segments.length) {
      return value;
    }
    const key = segments[index];
    const isObj = isPlainObject(current);
    const base = isObj ? { ...(current as Record<string, unknown>) } : {};
    base[key] = updateRec(isObj ? (current as Record<string, unknown>)[key] : undefined, index + 1);
    return base;
  }

  return updateRec(doc, 0) as Record<string, unknown>;
}

/** Stable identity for a document, used to match rows across refetches. */
export function docKey(doc: Record<string, unknown>): string {
  return JSON.stringify(doc._id) ?? '';
}
