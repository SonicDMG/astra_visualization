// Pure module: no imports from server-only, Next.js, React, or the DOM.

import type {
  Condition,
  ConditionOp,
  FilterGroup,
  FilterTree,
  FilterValue,
  SortKey,
} from './types';
import type { FieldType, FieldInfo } from '@/lib/astra/schema';
import { isFieldIndexed } from '@/lib/astra/schema';

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
