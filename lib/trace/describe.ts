import { displayPath } from '@/lib/query/compile';
import { SORT_MAX_DOCUMENTS, type QuerySpec } from '@/lib/query/types';
import type { DataApiCallInfo, TraceHandling } from './types';

/** Plain-language answer to "where was this handled, and why". */
export interface Verdict {
  handling: Exclude<TraceHandling, 'blocked'>;
  reason: string;
  /** Sorted pages only: how much Astra has to order to serve this page. */
  paging?: string;
}

export const HANDLING_LABEL: Record<TraceHandling, string> = {
  local: 'Sorted in your browser',
  'astra-memory': 'Sorted in Astra memory',
  'astra-live': 'Live query on Astra',
  blocked: 'Nothing ran',
};

export const HANDLING_SHORT: Record<TraceHandling, string> = {
  local: 'Browser',
  'astra-memory': 'Astra memory',
  'astra-live': 'Astra live',
  blocked: 'Blocked',
};

/** CSS colour per handling; used for the verdict strip, the diagram path and history tags. */
export const HANDLING_COLOR: Record<TraceHandling, string> = {
  local: '#a78bfa',
  'astra-memory': '#f59e0b',
  'astra-live': '#34d399',
  blocked: '#fb7185',
};

const SORT_LIMIT = SORT_MAX_DOCUMENTS.toLocaleString('en-US');

const SEARCH_LABEL: Record<string, string> = {
  semantic: 'Semantic',
  keyword: 'Keyword',
  hybrid: 'Hybrid',
};

/** Short name for the kind of query, e.g. `Browse`, `Keyword search`. */
export function queryKind(spec: QuerySpec): string {
  return spec.searchMode === 'browse' ? 'Browse' : `${SEARCH_LABEL[spec.searchMode]} search`;
}

/** What the user did, as one short line. `kind` tells a refresh apart from other fetches. */
export function describeTrigger(spec: QuerySpec, kind: 'refresh' | 'query'): string {
  const parts: string[] = [kind === 'refresh' ? `Refresh · ${queryKind(spec)}` : queryKind(spec)];
  if (spec.searchMode !== 'browse' && spec.searchInput.text) {
    parts.push(`"${spec.searchInput.text}"`);
  }
  if (spec.sort.length > 0) {
    parts.push(
      `sorted by ${spec.sort
        .map((k) => `${displayPath(k.field)} ${k.dir === 'asc' ? '▲' : '▼'}`)
        .join(', ')}`,
    );
  }
  const filters = spec.filter.children.length;
  if (filters > 0) parts.push(`${filters} filter${filters > 1 ? 's' : ''}`);
  if (spec.searchMode === 'browse' && spec.pageIndex > 0) parts.push(`page ${spec.pageIndex + 1}`);
  return parts.join(' · ');
}

/** Classifies a request that reaches Astra (anything but a browser-side re-sort). */
export function classifyQuery(spec: QuerySpec): Verdict {
  if (spec.searchMode !== 'browse') {
    const how: Record<string, string> = {
      semantic: 'Astra searches by meaning (vector similarity)',
      keyword: 'Astra matches the words in your query',
      hybrid: 'Astra combines vector and keyword matches, then reranks them',
    };
    return {
      handling: 'astra-live',
      reason: `${how[spec.searchMode]} and returns up to ${spec.searchLimit.toLocaleString('en-US')} results in one response.`,
    };
  }

  if (spec.sort.length === 0) {
    return {
      handling: 'astra-live',
      reason: 'No sort is applied, so Astra reads this page straight from the collection.',
    };
  }

  const skip = spec.pageIndex * spec.pageSize;
  const ordered = Math.min(skip + spec.pageSize, SORT_MAX_DOCUMENTS);
  return {
    handling: 'astra-memory',
    reason: `A sort is applied, so Astra loads the matching documents (up to ${SORT_LIMIT}) into memory, sorts them, and returns one page.`,
    paging:
      spec.pageIndex === 0
        ? `Page 1 asks Astra to order ${ordered.toLocaleString('en-US')} of up to ${SORT_LIMIT} documents. Later pages cost more because Astra orders skip + page size again.`
        : `Page ${spec.pageIndex + 1} asks Astra to order ${ordered.toLocaleString('en-US')} of up to ${SORT_LIMIT} documents (skip ${skip.toLocaleString('en-US')} + ${spec.pageSize}). Astra repeats this for every page.`,
  };
}

/** The verdict for re-sorting already-loaded search results. */
export function localSortVerdict(rowCount: number): Verdict {
  return {
    handling: 'local',
    reason: `Search results are already loaded, so your browser re-sorts the ${rowCount.toLocaleString('en-US')} rows it has. Nothing is sent to Astra.`,
  };
}

// ─── Describing the real requests ───────────────────────────────────────────

function compact(value: unknown, max = 70): string {
  const text = JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The browser's request to this app's API, e.g. `GET /api/query?keyspace=…&so=title:asc`. */
export function appRequestLabel(path: '/api/query' | '/api/count', query: string): string {
  // `ft` (inferred field types) is an internal hint, not something worth teaching.
  const withoutHints = query.replace(/(^|&)ft=[^&]*/g, '').replace(/^&/, '');
  const decoded = decodeURIComponent(withoutHints.replace(/\+/g, ' '));
  const text = `GET ${path}?${decoded}`;
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}

type Body = {
  filter?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  options?: { skip?: number; limit?: number; pageState?: string };
  update?: Record<string, unknown>;
};

function bodyOf(call: DataApiCallInfo): Body {
  const outer = call.body as Record<string, Body | undefined>;
  return outer?.[call.command] ?? {};
}

const SEARCH_SORT_KEYS = ['$vector', '$vectorize', '$lexical', '$hybrid'];

/** One line saying what the request asks for: command, filter, sort, skip and limit. */
export function callSummary(call: DataApiCallInfo): string {
  const body = bodyOf(call);
  const parts = [call.command];
  if (body.filter && Object.keys(body.filter).length > 0) parts.push(`filter ${compact(body.filter, 60)}`);
  if (body.update) parts.push(`update ${compact(body.update, 60)}`);
  if (body.sort) parts.push(`sort ${compact(body.sort, 60)}`);
  if (body.options?.skip !== undefined) parts.push(`skip ${body.options.skip}`);
  if (body.options?.limit !== undefined) parts.push(`limit ${body.options.limit}`);
  if (body.options?.pageState) parts.push('pageState (continues the previous page)');
  return parts.join(' · ');
}

/** What Astra does for this call, in plain words. */
export function describeCall(call: DataApiCallInfo): { title: string; detail: string } {
  const body = bodyOf(call);
  const sortKeys = body.sort ? Object.keys(body.sort) : [];
  switch (call.command) {
    case 'updateOne':
      return {
        title: 'Astra updates the document',
        detail: 'Executes an updateOne command to persist the updated field value.',
      };
    case 'find': {
      if (sortKeys.some((k) => SEARCH_SORT_KEYS.includes(k))) {
        const how = sortKeys.includes('$lexical')
          ? 'matches the words in your query'
          : 'finds the closest vectors';
        return { title: 'Astra searches', detail: `Astra ${how} and returns up to ${body.options?.limit ?? '?'} documents.` };
      }
      if (sortKeys.length > 0) {
        const ordered = Math.min(
          (body.options?.skip ?? 0) + (body.options?.limit ?? 0),
          SORT_MAX_DOCUMENTS,
        );
        return {
          title: 'Astra sorts in memory',
          detail: `Loads the matching documents (up to ${SORT_LIMIT}), sorts them, skips ${body.options?.skip ?? 0} and returns ${body.options?.limit ?? '?'}. Orders about ${ordered.toLocaleString('en-US')} documents for this page.`,
        };
      }
      return {
        title: 'Astra reads a page',
        detail: 'No sort, so Astra reads one page straight from the collection.',
      };
    }
    case 'findAndRerank':
      return {
        title: 'Astra searches and reranks',
        detail: 'Runs a vector search and a keyword search, then a reranking model orders the combined results.',
      };
    case 'findOne':
      return { title: 'Astra reads the source vector', detail: 'Fetches the stored $vector of the document you chose.' };
    case 'findCollections':
      return {
        title: 'Astra describes the collection',
        detail: 'Reads which search features (vector, keyword, rerank) the collection supports.',
      };
    case 'countDocuments':
      return {
        title: 'Astra counts the matches',
        detail: 'Counts documents matching the filter. The Data API caps this at 1,000.',
      };
    case 'estimatedDocumentCount':
      return { title: 'Astra estimates the total', detail: 'A fast approximate count of the whole collection.' };
    default:
      return { title: `Astra runs ${call.command}`, detail: '' };
  }
}

/** Commands the Astra API Console offers, keyed by Data API command, with the name it shows. */
const CONSOLE_COMMANDS: Record<string, string> = {
  find: 'Find documents',
  findOne: 'Find one document',
  countDocuments: 'Count documents',
  updateOne: 'Update one document',
};

/**
 * Whether a call can be pasted into the Astra API Console, and if so which command to choose
 * there (the console rejects a body that does not match its selected command).
 */
export function consoleTarget(
  call: DataApiCallInfo,
): { ok: true; label: string } | { ok: false; reason: string } {
  // bodyForDisplay shortens long vectors to a "[N numbers]" string, which is not valid to send.
  if (/"\[\d+ numbers\]"/.test(JSON.stringify(call.body))) {
    return { ok: false, reason: 'This request contains a long vector that is shortened for display.' };
  }
  if (call.command === 'findCollections') {
    const explain = (call.body as { findCollections?: { options?: { explain?: boolean } } })
      .findCollections?.options?.explain;
    return { ok: true, label: explain ? 'List collection metadata' : 'List collection names' };
  }
  const label = CONSOLE_COMMANDS[call.command];
  return label
    ? { ok: true, label }
    : { ok: false, reason: `The API Console does not offer the ${call.command} command.` };
}

/**
 * Copy-able form of a call, so users can reproduce it. The token is never included. The response
 * is piped through jq for readable output (curl -s keeps its progress meter out of the pipe).
 */
export function callAsCurl(call: DataApiCallInfo): string {
  return [
    `curl -s -X ${call.method} "$ASTRA_DB_API_ENDPOINT${call.path}" \\`,
    `  -H "Token: $ASTRA_DB_APPLICATION_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${JSON.stringify(call.body, null, 2)}' \\`,
    `  | jq .`,
  ].join('\n');
}
