// Pure module: no imports from server-only, Next.js, React, or the DOM.

import {
  type Condition,
  type ConditionOp,
  type FilterGroup,
  type FilterTree,
  type FilterValue,
  type QuerySpec,
  type SearchMode,
  type SortKey,
  clampSearchLimit,
} from './types';
import type { FieldType, FieldInfo } from '@/lib/astra/schema';
import { getByEscapedPath, isDollarDate, isFieldIndexed, unwrapScalar } from '@/lib/astra/schema';
import type { CollectionCapabilities } from '@/lib/astra/gateway';

/*
 * Field-path escaping — the ONE definition used across the app.
 *
 * The Data API addresses nested fields with dotted paths (`address.city`). To
 * name a key that itself contains `.` or `&`, each *segment* is escaped:
 *   `&` -> `&&`   and   `.` -> `&.`
 * The `.` that separates nesting levels stays a plain `.`.
 *
 * Example: the key "a.b" nested under "x" is the path `x.a&.b`.
 *
 * An "escaped path" (e.g. `FieldInfo.escapedPath`, `SortKey.field`) is a dotted
 * path whose segments are already escaped this way.
 */

/** Escapes one path segment (a raw key name) for the Data API. */
export function escapeFieldSegment(segment: string): string {
  return segment.replaceAll('&', '&&').replaceAll('.', '&.');
}

/** Reverses {@link escapeFieldSegment}. A lone `&` is kept as a literal `&`. */
export function unescapeFieldSegment(segment: string): string {
  return segment.replace(/&([&.])/g, '$1');
}

/** Splits an escaped path into its (still escaped) segments, honouring `&.` and `&&`. */
export function splitEscapedPath(path: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    const next = path[i + 1];
    if (ch === '&' && (next === '&' || next === '.')) {
      current += ch + next;
      i++;
    } else if (ch === '.') {
      segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  segments.push(current);
  return segments;
}

/** Human-readable path (`a.b.c`) for an escaped path; literal dots in key names are unescaped. */
export function displayPath(escapedPath: string): string {
  return splitEscapedPath(escapedPath).map(unescapeFieldSegment).join('.');
}

/**
 * Re-escapes every segment of a path. Idempotent for well-formed escaped paths;
 * a stray `&` (not followed by `&` or `.`) is treated as a literal and doubled.
 */
function normalizeEscapedPath(path: string): string {
  return splitEscapedPath(path)
    .map((segment) => escapeFieldSegment(unescapeFieldSegment(segment)))
    .join('.');
}

/**
 * Compiles a sort spec to the Data API `sort` option: asc -> 1, desc -> -1.
 * `SortKey.field` is an escaped dotted path (see above), normalised here so the
 * output is always valid for the Data API. Key order is preserved (it is the sort
 * priority); duplicate fields keep their first occurrence.
 * Caveat: JS orders integer-like property names first, so such top-level keys
 * (e.g. a field literally named "1") cannot keep their relative priority.
 */
export function compileSort(sort: SortKey[]): Record<string, 1 | -1> {
  const compiled: Record<string, 1 | -1> = {};
  for (const { field, dir } of sort) {
    const key = normalizeEscapedPath(field);
    if (key in compiled) continue;
    compiled[key] = dir === 'asc' ? 1 : -1;
  }
  return compiled;
}

/**
 * Computes the next sort after a header click.
 *  - Plain click: sort becomes only `field`, cycling its current direction
 *    asc -> desc -> off (off yields an empty sort).
 *  - `additive` (Shift-click): keeps the other keys; a new field is appended as asc,
 *    an existing one cycles asc -> desc -> removed in place.
 */
export function cycleSort(sort: SortKey[], field: string, additive: boolean): SortKey[] {
  const existing = sort.find((k) => k.field === field);
  const nextDir: SortKey['dir'] | null =
    existing === undefined ? 'asc' : existing.dir === 'asc' ? 'desc' : null;

  if (!additive) {
    return nextDir === null ? [] : [{ field, dir: nextDir }];
  }
  if (existing === undefined) return [...sort, { field, dir: 'asc' }];
  if (nextDir === null) return sort.filter((k) => k.field !== field);
  return sort.map((k) => (k.field === field ? { field, dir: nextDir } : k));
}

// ─── Filter compilation ─────────────────────────────────────────────────────

function parseDateToMillis(val: FilterValue | undefined): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const millis = Date.parse(val);
    if (!Number.isNaN(millis)) return millis;
  }
  if (typeof val === 'object' && val !== null && '$date' in (val as Record<string, unknown>)) {
    const d = (val as { $date: unknown }).$date;
    if (typeof d === 'number') return d;
  }
  throw new Error(`Invalid date value for dollarDate: ${String(val)}`);
}

function toDollarDate(val: FilterValue | undefined): { $date: number } {
  return { $date: parseDateToMillis(val) };
}

function compileCondition(
  cond: Condition,
  fieldTypes?: Record<string, FieldType>,
): Record<string, unknown> {
  const field = normalizeEscapedPath(cond.field);
  const isDollar = fieldTypes?.[cond.field] === 'dollarDate';

  const formatVal = (v: FilterValue | undefined): unknown => {
    if (isDollar && v !== undefined && v !== null && v !== '') {
      return toDollarDate(v);
    }
    return v;
  };

  const formatVals = (vals: FilterValue[] | undefined): unknown[] => {
    if (!vals) return [];
    if (isDollar) {
      return vals.map(toDollarDate);
    }
    return vals;
  };

  switch (cond.op) {
    case 'eq':
      return { [field]: { $eq: formatVal(cond.value) } };
    case 'ne':
      return { [field]: { $ne: formatVal(cond.value) } };
    case 'exists':
      return { [field]: { $exists: true } };
    case 'notExists':
      return { [field]: { $exists: false } };
    case 'in':
      return { [field]: { $in: formatVals(cond.values) } };
    case 'nin':
      return { [field]: { $nin: formatVals(cond.values) } };
    case 'gt':
      return { [field]: { $gt: formatVal(cond.value) } };
    case 'gte':
      return { [field]: { $gte: formatVal(cond.value) } };
    case 'lt':
      return { [field]: { $lt: formatVal(cond.value) } };
    case 'lte':
      return { [field]: { $lte: formatVal(cond.value) } };
    case 'between':
      return { [field]: { $gte: formatVal(cond.value), $lte: formatVal(cond.value2) } };
    case 'before':
      return { [field]: { $lt: formatVal(cond.value) } };
    case 'after':
      return { [field]: { $gt: formatVal(cond.value) } };
    case 'dateBetween':
      return { [field]: { $gte: formatVal(cond.value), $lte: formatVal(cond.value2) } };
    case 'containsAny':
      return { [field]: { $in: formatVals(cond.values) } };
    case 'containsAll':
      return { [field]: { $all: formatVals(cond.values) } };
    case 'sizeIs':
      return {
        [field]: {
          $size: typeof cond.value === 'number' ? cond.value : Number(cond.value ?? 0),
        },
      };
    case 'isTrue':
      return { [field]: { $eq: true } };
    case 'isFalse':
      return { [field]: { $eq: false } };
  }
}

/**
 * Negates a single condition according to De Morgan's laws when compiling groups with `not: true`.
 * In the Astra Data API, `$not` is a field-level operator and cannot wrap logical groups (`$and`/`$or`).
 * Applying De Morgan's laws flips the group combinator and inverts each child condition.
 */
function compileNegatedCondition(
  cond: Condition,
  fieldTypes?: Record<string, FieldType>,
): Record<string, unknown> {
  const field = normalizeEscapedPath(cond.field);
  const isDollar = fieldTypes?.[cond.field] === 'dollarDate';

  const formatVal = (v: FilterValue | undefined): unknown => {
    if (isDollar && v !== undefined && v !== null && v !== '') {
      return toDollarDate(v);
    }
    return v;
  };

  const formatVals = (vals: FilterValue[] | undefined): unknown[] => {
    if (!vals) return [];
    if (isDollar) {
      return vals.map(toDollarDate);
    }
    return vals;
  };

  switch (cond.op) {
    case 'eq':
      return { [field]: { $ne: formatVal(cond.value) } };
    case 'ne':
      return { [field]: { $eq: formatVal(cond.value) } };
    case 'exists':
      return { [field]: { $exists: false } };
    case 'notExists':
      return { [field]: { $exists: true } };
    case 'in':
      return { [field]: { $nin: formatVals(cond.values) } };
    case 'nin':
      return { [field]: { $in: formatVals(cond.values) } };
    case 'gt':
      return { [field]: { $lte: formatVal(cond.value) } };
    case 'gte':
      return { [field]: { $lt: formatVal(cond.value) } };
    case 'lt':
      return { [field]: { $gte: formatVal(cond.value) } };
    case 'lte':
      return { [field]: { $gt: formatVal(cond.value) } };
    case 'before':
      return { [field]: { $gte: formatVal(cond.value) } };
    case 'after':
      return { [field]: { $lte: formatVal(cond.value) } };
    case 'between':
    case 'dateBetween':
      return {
        $or: [
          { [field]: { $lt: formatVal(cond.value) } },
          { [field]: { $gt: formatVal(cond.value2) } },
        ],
      };
    case 'containsAny':
      return { [field]: { $nin: formatVals(cond.values) } };
    case 'containsAll':
      return { [field]: { $not: { $all: formatVals(cond.values) } } };
    case 'sizeIs':
      return {
        [field]: {
          $not: { $size: typeof cond.value === 'number' ? cond.value : Number(cond.value ?? 0) },
        },
      };
    case 'isTrue':
      return { [field]: { $eq: false } };
    case 'isFalse':
      return { [field]: { $eq: true } };
  }
}

function compileGroup(
  group: FilterGroup,
  fieldTypes?: Record<string, FieldType>,
): Record<string, unknown> {
  if (group.children.length === 0) return {};

  if (!group.not) {
    if (group.children.length === 1) {
      return compileCondition(group.children[0], fieldTypes);
    }
    const compiled = group.children.map((c) => compileCondition(c, fieldTypes));
    return { [`$${group.combinator}`]: compiled };
  }

  // De Morgan's Law for NOT(group):
  // NOT (A AND B) = (NOT A) OR (NOT B)
  // NOT (A OR B)  = (NOT A) AND (NOT B)
  // The Astra Data API does not support top-level `{ $not: { $and: [...] } }`.
  // We flip the group's combinator and negate each child condition.
  const flippedCombinator = group.combinator === 'and' ? 'or' : 'and';
  if (group.children.length === 1) {
    return compileNegatedCondition(group.children[0], fieldTypes);
  }
  const compiled = group.children.map((c) => compileNegatedCondition(c, fieldTypes));
  return { [`$${flippedCombinator}`]: compiled };
}

/**
 * Compiles a FilterTree into a Data API filter document.
 * Unwraps single children where possible; returns `{}` for empty trees.
 */
export function compileFilter(
  tree: FilterTree,
  fieldTypes?: Record<string, FieldType>,
): Record<string, unknown> {
  if (!tree || !Array.isArray(tree.children) || tree.children.length === 0) {
    return {};
  }

  const validChildren = tree.children.filter((c) => {
    if (c.kind === 'group') return c.children.length > 0;
    return true;
  });

  if (validChildren.length === 0) return {};

  if (validChildren.length === 1) {
    const child = validChildren[0];
    if (child.kind === 'condition') {
      return compileCondition(child, fieldTypes);
    }
    return compileGroup(child, fieldTypes);
  }

  const compiledChildren = validChildren.map((c) => {
    if (c.kind === 'condition') {
      return compileCondition(c, fieldTypes);
    }
    return compileGroup(c, fieldTypes);
  });

  return { [`$${tree.combinator}`]: compiledChildren };
}

// ─── Filter validation ──────────────────────────────────────────────────────

export type FilterIssueCode =
  | 'NON_INDEXED_FIELD'
  | 'TOO_MANY_IN_VALUES'
  | 'TOO_MANY_CONDITIONS'
  | 'MISSING_VALUE'
  | 'INVALID_DATE';

export type FilterIssue = {
  path?: string;
  message: string;
  code: FilterIssueCode;
};

export type FieldMetaInput =
  | {
      indexing?: { allow: string[] } | { deny: string[] } | null;
      fieldTypes?: Record<string, FieldType>;
    }
  | Record<string, { indexed?: boolean; type?: FieldType }>
  | FieldInfo[];

/**
 * Validates a FilterTree against indexing options and Data API constraints.
 * Flags: non-indexed field, >100 values in in/nin, total conditions > 64, missing required values, invalid dates.
 */
export function validateFilter(
  tree: FilterTree,
  fieldMeta?: FieldMetaInput,
): FilterIssue[] {
  const issues: FilterIssue[] = [];
  if (!tree || !Array.isArray(tree.children)) return issues;

  // Extract indexing config if available
  let indexing: { allow: string[] } | { deny: string[] } | null | undefined;
  let fieldMap: Record<string, { indexed?: boolean; type?: FieldType }> | undefined;

  if (fieldMeta) {
    if (Array.isArray(fieldMeta)) {
      fieldMap = Object.fromEntries(
        fieldMeta.map((f) => [f.escapedPath, { indexed: true, type: f.type }]),
      );
    } else if ('indexing' in fieldMeta || 'fieldTypes' in fieldMeta) {
      indexing = (fieldMeta as { indexing?: { allow: string[] } | { deny: string[] } | null }).indexing;
    } else {
      fieldMap = fieldMeta as Record<string, { indexed?: boolean; type?: FieldType }>;
    }
  }

  const allConditions: Condition[] = [];
  for (const child of tree.children) {
    if (child.kind === 'condition') {
      allConditions.push(child);
    } else if (child.kind === 'group') {
      allConditions.push(...child.children);
    }
  }

  if (allConditions.length > 64) {
    issues.push({
      message: `Filter contains ${allConditions.length} conditions, exceeding the maximum of 64.`,
      code: 'TOO_MANY_CONDITIONS',
    });
  }

  for (const cond of allConditions) {
    // Check indexing
    if (indexing !== undefined) {
      if (!isFieldIndexed(cond.field, indexing)) {
        issues.push({
          path: cond.field,
          message: `Field "${displayPath(cond.field)}" is not indexed and cannot be filtered.`,
          code: 'NON_INDEXED_FIELD',
        });
      }
    } else if (fieldMap && fieldMap[cond.field]?.indexed === false) {
      issues.push({
        path: cond.field,
        message: `Field "${displayPath(cond.field)}" is not indexed and cannot be filtered.`,
        code: 'NON_INDEXED_FIELD',
      });
    }

    // Check operators
    const multiOps: ReadonlySet<ConditionOp> = new Set([
      'in',
      'nin',
      'containsAny',
      'containsAll',
    ]);
    if (multiOps.has(cond.op)) {
      if (!cond.values || cond.values.length === 0) {
        issues.push({
          path: cond.field,
          message: `Condition on "${displayPath(cond.field)}" requires at least one value.`,
          code: 'MISSING_VALUE',
        });
      } else if (cond.values.length > 100) {
        issues.push({
          path: cond.field,
          message: `Operator "${cond.op}" on "${displayPath(cond.field)}" has ${cond.values.length} values, exceeding the maximum of 100.`,
          code: 'TOO_MANY_IN_VALUES',
        });
      }
    } else if (cond.op === 'between' || cond.op === 'dateBetween') {
      const v1Empty = cond.value === undefined || cond.value === null || cond.value === '';
      const v2Empty = cond.value2 === undefined || cond.value2 === null || cond.value2 === '';
      if (v1Empty || v2Empty) {
        issues.push({
          path: cond.field,
          message: `Between range on "${displayPath(cond.field)}" requires both start and end values.`,
          code: 'MISSING_VALUE',
        });
      }
      if (cond.op === 'dateBetween') {
        if (
          (typeof cond.value === 'string' && Number.isNaN(Date.parse(cond.value))) ||
          (typeof cond.value2 === 'string' && Number.isNaN(Date.parse(cond.value2)))
        ) {
          issues.push({
            path: cond.field,
            message: `Invalid date range for "${displayPath(cond.field)}".`,
            code: 'INVALID_DATE',
          });
        }
      }
    } else if (
      cond.op !== 'isTrue' &&
      cond.op !== 'isFalse' &&
      cond.op !== 'exists' &&
      cond.op !== 'notExists'
    ) {
      const vEmpty = cond.value === undefined || cond.value === null || cond.value === '';
      if (vEmpty) {
        issues.push({
          path: cond.field,
          message: `Condition on "${displayPath(cond.field)}" requires a value.`,
          code: 'MISSING_VALUE',
        });
      } else if (
        (cond.op === 'before' || cond.op === 'after') &&
        typeof cond.value === 'string' &&
        Number.isNaN(Date.parse(cond.value))
      ) {
        issues.push({
          path: cond.field,
          message: `Invalid date format "${cond.value}" for "${displayPath(cond.field)}".`,
          code: 'INVALID_DATE',
        });
      }
    }
  }

  return issues;
}

// ─── Search modes ───────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

/** The slice of `CollectionCapabilities` that search validation/compilation needs. */
export type SearchCapabilities = Pick<
  CollectionCapabilities,
  'hasVector' | 'vectorDimension' | 'vectorizeProvider' | 'vectorizeNeedsKey' | 'hasLexical' | 'hasRerank'
>;

export const SEARCH_MODE_LABELS: Record<SearchMode, string> = {
  browse: 'Browse',
  semantic: 'Semantic',
  keyword: 'Keyword',
  hybrid: 'Hybrid',
};

/** Synthetic result columns (not stored in documents), shown first after `_id`. */
export const SCORE_FIELDS: readonly string[] = ['$similarity', '$rerank', '$vectorScore', '$lexicalScore'];

export function isSearchMode(mode: SearchMode): boolean {
  return mode !== 'browse';
}

/** Whether semantic/hybrid TEXT queries can be embedded server-side by the collection's vectorize service. */
export function canVectorizeText(caps: SearchCapabilities): boolean {
  return caps.hasVector && caps.vectorizeProvider !== null && !caps.vectorizeNeedsKey;
}

/** Search modes a collection supports. Browse is always first. */
export function supportedSearchModes(caps: SearchCapabilities): SearchMode[] {
  const modes: SearchMode[] = ['browse'];
  if (caps.hasVector) modes.push('semantic');
  if (caps.hasLexical) modes.push('keyword');
  if (caps.hasLexical && caps.hasVector && caps.hasRerank) modes.push('hybrid');
  return modes;
}

/**
 * The ONE place the `filter` for every find path (browse, semantic, keyword, hybrid) is built.
 */
export function buildFindFilter(
  spec: Pick<QuerySpec, 'filter'>,
  fieldTypes?: Record<string, FieldType>,
): Record<string, unknown> {
  return compileFilter(spec.filter, fieldTypes);
}

/**
 * Parses a pasted vector: a JSON array (`[0.1, 0.2]`) or comma/whitespace-separated numbers.
 * Never throws.
 */
export function parseVectorInput(input: string): { vector: number[] } | { error: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { error: 'Enter a vector.' };
  let items: unknown[];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { error: 'Not valid JSON. Use [0.1, 0.2, …] or comma-separated numbers.' };
    }
    if (!Array.isArray(parsed)) return { error: 'Expected a JSON array of numbers.' };
    items = parsed;
  } else {
    items = trimmed.split(/[\s,]+/).filter((s) => s !== '').map(Number);
  }
  if (items.length === 0) return { error: 'The vector is empty.' };
  const vector: number[] = [];
  for (const item of items) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      return { error: 'Every vector element must be a finite number.' };
    }
    vector.push(item);
  }
  return { vector };
}

export type SearchIssueCode =
  | 'SEARCH_MODE_UNSUPPORTED'
  | 'SEARCH_TEXT_REQUIRED'
  | 'SEARCH_VECTOR_REQUIRED'
  | 'SEARCH_VECTOR_DIMENSION'
  | 'SEARCH_VECTORIZE_UNAVAILABLE';

export type SearchIssue = { code: SearchIssueCode; message: string };

/**
 * Validates a search spec against the collection's capabilities BEFORE anything is sent.
 *  - mode unsupported by the collection
 *  - empty text for text modes
 *  - vector missing / wrong dimension
 *  - text embedding impossible (no vectorize, or vectorize needs an API key we don't have)
 * Field sort is not an error: in search modes it is applied locally and never sent.
 */
export function validateSearch(spec: QuerySpec, caps: SearchCapabilities): SearchIssue[] {
  const mode = spec.searchMode;
  if (mode === 'browse') return [];

  if (!supportedSearchModes(caps).includes(mode)) {
    return [
      {
        code: 'SEARCH_MODE_UNSUPPORTED',
        message: `${SEARCH_MODE_LABELS[mode]} search is not available for this collection.`,
      },
    ];
  }

  const text = spec.searchInput.text.trim();
  const vector = spec.searchInput.vector;
  const textRequired: SearchIssue = {
    code: 'SEARCH_TEXT_REQUIRED',
    message: 'Enter search text.',
  };
  const vectorRequired: SearchIssue = {
    code: 'SEARCH_VECTOR_REQUIRED',
    message: 'Enter a query vector.',
  };
  const vectorizeUnavailable: SearchIssue = {
    code: 'SEARCH_VECTORIZE_UNAVAILABLE',
    message: caps.vectorizeNeedsKey
      ? 'This collection’s embedding provider needs an API key, which this app does not send. Search with a vector instead.'
      : 'This collection has no vectorize service. Search with a vector instead.',
  };
  const hybridNeedsVectorize: SearchIssue = {
    code: 'SEARCH_VECTORIZE_UNAVAILABLE',
    message: caps.vectorizeNeedsKey
      ? 'Hybrid search needs the embedding service, whose API key this app does not send.'
      : 'Hybrid search needs a collection with a vectorize service.',
  };
  const dimensionIssue = (v: number[]): SearchIssue[] =>
    caps.vectorDimension !== null && v.length !== caps.vectorDimension
      ? [
          {
            code: 'SEARCH_VECTOR_DIMENSION',
            message: `Vector has ${v.length} dimensions; this collection expects ${caps.vectorDimension}.`,
          },
        ]
      : [];

  switch (mode) {
    case 'keyword':
      return text === '' ? [textRequired] : [];
    case 'semantic':
      // "Find similar" resolves the vector server-side from the source document.
      if (spec.similarTo !== null) return [];
      if (spec.semanticSource === 'vector') {
        return vector ? dimensionIssue(vector) : [vectorRequired];
      }
      if (text === '') return [textRequired];
      return canVectorizeText(caps) ? [] : [vectorizeUnavailable];
    case 'hybrid':
      // Hybrid is text-driven: one string feeds both `$vectorize` and `$lexical`.
      if (text === '') return [textRequired];
      return canVectorizeText(caps) ? [] : [hybridNeedsVectorize];
  }
}

export type SearchRequest = {
  /** Data API command name; its body is `{ [command]: body }`. */
  command: 'find' | 'findAndRerank';
  body: Record<string, unknown>;
};

export type CompileSearchOptions = {
  fieldTypes?: Record<string, FieldType>;
  /** Data API projection. Defaults to `{ $vector: 0 }`. */
  projection?: Record<string, 0 | 1>;
  /** A vector resolved server-side ("find similar"); takes precedence in semantic mode. */
  vector?: number[] | null;
  /** Whether text can be embedded by the collection's vectorize service (see {@link canVectorizeText}). */
  vectorize: boolean;
};

/**
 * Compiles a search-mode spec to a Data API command, or `null` when there is nothing to send
 * (browse mode, or no usable query — call {@link validateSearch} first for readable errors).
 *
 * Search commands never carry `skip`, `pageState`, or a field sort: `spec.sort` is
 * ignored here (it is applied locally to the results) and vector/lexical/hybrid
 * ranking is the only ordering the Data API may be asked for.
 *
 * Wire shapes (Data API docs "Sort clauses for collections", "Find documents", "Find and rerank"):
 *  - semantic text:   find { sort: { $vectorize }, options: { limit, includeSimilarity } }
 *  - semantic vector: find { sort: { $vector },    options: { limit, includeSimilarity } }
 *  - keyword:         find { sort: { $lexical: "words" }, options: { limit } }
 *  - hybrid:          findAndRerank { sort: { $hybrid }, options: { limit, hybridLimits, includeScores } }
 */
export function compileSearch(spec: QuerySpec, opts: CompileSearchOptions): SearchRequest | null {
  const limit = clampSearchLimit(spec.searchLimit);
  const filter = buildFindFilter(spec, opts.fieldTypes);
  const projection = opts.projection ?? { $vector: 0 };
  const text = spec.searchInput.text.trim();
  const inputVector = spec.searchInput.vector;

  switch (spec.searchMode) {
    case 'browse':
      return null;
    case 'semantic': {
      let sort: Record<string, unknown> | null;
      if (opts.vector) sort = { $vector: opts.vector };
      else if (spec.semanticSource === 'vector') sort = inputVector ? { $vector: inputVector } : null;
      else sort = text !== '' ? { $vectorize: text } : null;
      if (!sort) return null;
      return {
        command: 'find',
        body: { filter, sort, projection, options: { limit, includeSimilarity: true } },
      };
    }
    case 'keyword':
      if (text === '') return null;
      return {
        command: 'find',
        body: { filter, sort: { $lexical: text }, projection, options: { limit } },
      };
    case 'hybrid':
      // The string shorthand feeds both the $vectorize and $lexical queries.
      if (text === '' || !opts.vectorize) return null;
      return {
        command: 'findAndRerank',
        body: {
          filter,
          sort: { $hybrid: text },
          projection,
          options: { limit, hybridLimits: limit, includeScores: true },
        },
      };
  }
}

/** `status.documentResponses[].scores` key -> synthetic document field. */
const RERANK_SCORE_FIELDS: Record<string, string> = {
  $rerank: '$rerank',
  $reranker: '$rerank',
  // Component scores are renamed so they don't collide with the stored `$vector` / `$lexical` fields.
  $vector: '$vectorScore',
  $lexical: '$lexicalScore',
};

/**
 * Merges `findAndRerank` scores (`status.documentResponses`, index-matched to the
 * returned documents) into each document as synthetic fields (`$rerank`, `$vectorScore`, `$lexicalScore`).
 */
export function mergeRerankScores(documents: Doc[], documentResponses: unknown): Doc[] {
  const responses = Array.isArray(documentResponses) ? (documentResponses as unknown[]) : [];
  return documents.map((doc, index) => {
    const response = responses[index];
    const scores =
      typeof response === 'object' && response !== null
        ? (response as { scores?: unknown }).scores
        : undefined;
    if (typeof scores !== 'object' || scores === null) return doc;
    const merged: Doc = { ...doc };
    for (const [key, value] of Object.entries(scores)) {
      if (typeof value === 'number') merged[RERANK_SCORE_FIELDS[key] ?? key] = value;
    }
    return merged;
  });
}

// ─── Local (browser-side) sort for search modes ─────────────────────────────

/** Scalar used for local comparison; objects/arrays/missing values yield `null` (sorted last). */
function comparableValue(raw: unknown): number | string | boolean | null {
  if (raw === undefined || raw === null) return null;
  if (isDollarDate(raw)) return raw.$date;
  const value = unwrapScalar(raw);
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

const TYPE_RANK: Record<string, number> = { number: 0, string: 1, boolean: 2 };

/** Compares two non-null comparable values: numbers numerically, strings with `localeCompare`. */
export function compareLocal(a: number | string | boolean, b: number | string | boolean): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return TYPE_RANK[typeof a] - TYPE_RANK[typeof b];
}

/**
 * Stable multi-key sort of already-loaded documents. Null/missing values sort last in both
 * directions; ties keep the original (relevance) order. An empty `sort` returns `documents`
 * unchanged, which restores relevance order.
 */
export function sortDocumentsLocally(documents: Doc[], sort: SortKey[]): Doc[] {
  if (sort.length === 0) return documents;
  const keyed = documents.map((doc, index) => ({
    doc,
    index,
    values: sort.map((k) => comparableValue(getByEscapedPath(doc, k.field))),
  }));
  keyed.sort((x, y) => {
    for (let i = 0; i < sort.length; i++) {
      const a = x.values[i];
      const b = y.values[i];
      if (a === null && b === null) continue;
      if (a === null) return 1;
      if (b === null) return -1;
      const result = compareLocal(a, b);
      if (result !== 0) return sort[i].dir === 'asc' ? result : -result;
    }
    return x.index - y.index;
  });
  return keyed.map((k) => k.doc);
}
