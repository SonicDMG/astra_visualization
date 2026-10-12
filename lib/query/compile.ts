// Pure module: no imports from server-only, Next.js, React, or the DOM.

import type { SortKey } from './types';

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
