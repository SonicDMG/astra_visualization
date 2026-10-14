import 'server-only';

// ─── Env validation ─────────────────────────────────────────────────────────

const ENDPOINT = process.env.ASTRA_DB_API_ENDPOINT ?? '';
// Token is deliberately not exported — consumed only inside this module.
const TOKEN = process.env.ASTRA_DB_APPLICATION_TOKEN ?? '';

const ENDPOINT_PATTERN =
  /^https:\/\/[a-zA-Z0-9]+-[a-zA-Z0-9-]+\.apps\.astra\.datastax\.com/;

function validateConfig(): string | null {
  if (!ENDPOINT) {
    return 'ASTRA_DB_API_ENDPOINT is not set. Add it to your .env.local file.';
  }
  if (!TOKEN) {
    return 'ASTRA_DB_APPLICATION_TOKEN is not set. Add it to your .env.local file.';
  }
  if (!ENDPOINT_PATTERN.test(ENDPOINT)) {
    return (
      `ASTRA_DB_API_ENDPOINT "${ENDPOINT}" does not match the expected pattern ` +
      'https://<id>-<region>.apps.astra.datastax.com'
    );
  }
  return null;
}

/**
 * Module-level config error. Non-null when env vars are missing or malformed.
 * Import this in Server Components to gate the app shell.
 */
export const configError: string | null = validateConfig();

// ─── Types ──────────────────────────────────────────────────────────────────

import { parseCapabilities, type FieldType } from '@/lib/astra/schema';
import {
  buildFindFilter,
  canVectorizeText,
  compileSearch,
  compileSort,
  mergeRerankScores,
  validateSearch,
} from '@/lib/query/compile';
import { type DocId, type QuerySpec, SORT_MAX_DOCUMENTS } from '@/lib/query/types';
import type { DataApiCallInfo } from '@/lib/trace/types';

// Import SDK types for compatibility
import type {
  CollectionDescriptor as SDKCollectionDescriptor,
  CollectionDefinition as SDKCollectionDefinition,
  CollectionVectorOptions as SDKVectorOptions,
  CollectionLexicalOptions as SDKLexicalOptions,
  CollectionRerankOptions as SDKRerankOptions,
  VectorizeServiceOptions as SDKVectorizeServiceOptions,
  RerankServiceOptions as SDKRerankServiceOptions,
  CollectionDefaultIdOptions as SDKDefaultIdOptions,
  SomeDoc,
  Db,
} from '@datastax/astra-db-ts';

/** Re-export of SDK CollectionDescriptor with added capabilities */
export interface CollectionDescriptor extends SDKCollectionDescriptor {
  capabilities: CollectionCapabilities;
}

/** Collection definition with our capability extensions */
export type CollectionDefinition = SDKCollectionDefinition<SomeDoc>;

/** Vector options from SDK */
export type VectorOptions = SDKVectorOptions;

/** Lexical options from SDK */
export type LexicalOptions = SDKLexicalOptions;

/** Rerank options from SDK */
export type RerankOptions = SDKRerankOptions;

/** Vectorize service options from SDK */
export type VectorServiceOptions = SDKVectorizeServiceOptions;

/** Rerank service options from SDK */
export type RerankServiceOptions = SDKRerankServiceOptions;

/** Indexing options - flexible object */
export interface IndexingOptions {
  // Indexing configuration
  [key: string]: unknown;
}

/** Default ID options from SDK */
export type DefaultIdOptions = SDKDefaultIdOptions;

/** Normalized collection capabilities for UI */
export interface CollectionCapabilities {
  hasVector: boolean;
  vectorDimension: number | null;
  vectorMetric: string | null;
  vectorizeProvider: string | null;
  vectorizeModel: string | null;
  /** Vectorize provider needs an API key that the collection doesn't store (see `vectorizeRequiresHeaderKey`). */
  vectorizeNeedsKey: boolean;
  hasLexical: boolean;
  hasRerank: boolean;
  /** Collection `indexing` option; null = everything indexed. */
  indexing: { allow: string[] } | { deny: string[] } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Endpoint form: https://<DB_ID>-<region>.apps.astra.datastax.com, where DB_ID is a
// UUID (8-4-4-4-12 hex), so it contains dashes itself.
function parseDbId(endpoint: string): string | null {
  const match = endpoint.match(
    /^https:\/\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-[a-z0-9-]+\.apps\.astra\.datastax\.com/,
  );
  return match?.[1] ?? null;
}

async function fetchWithError(url: string, options: RequestInit): Promise<Response> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`
    );
  }
  return response;
}

// ─── Data API call recording (for the Live Query Trace) ─────────────────────

/** Copy of a request body that is safe to show: long number arrays (vectors) are shortened. */
function bodyForDisplay(body: unknown): unknown {
  return JSON.parse(
    JSON.stringify(body, (_key, value) =>
      Array.isArray(value) && value.length > 8 && value.every((n) => typeof n === 'number')
        ? `[${value.length} numbers]`
        : value,
    ),
  );
}

function dataApiPath(keyspace: string, collection?: string): string {
  return `/api/json/v1/${keyspace}${collection ? `/${collection}` : ''}`;
}

/** Runs one Data API command and, when `calls` is given, records what was sent and how long it took. */
async function timedCommand(
  db: Db,
  calls: DataApiCallInfo[] | undefined,
  keyspace: string,
  collection: string | undefined,
  payload: Record<string, unknown>,
) {
  const start = performance.now();
  let failed = false;
  try {
    const response = await db.command(payload, collection ? { collection } : undefined);
    failed = (response.errors?.length ?? 0) > 0;
    return response;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    calls?.push({
      command: Object.keys(payload)[0],
      method: 'POST',
      path: dataApiPath(keyspace, collection),
      body: bodyForDisplay(payload),
      ms: Math.round(performance.now() - start),
      ...(failed ? { failed: true } : {}),
    });
  }
}

// ─── Gateway functions ──────────────────────────────────────────────────────

export async function listKeyspaces(): Promise<
  { keyspaces: string[]; consoleBaseUrl: string | null } | { error: string }
> {
  try {
    const dbId = parseDbId(ENDPOINT);
    if (!dbId) {
      return { error: 'Could not parse database ID from endpoint' };
    }

    const url = `https://api.astra.datastax.com/v2/databases/${dbId}`;
    const response = await fetchWithError(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
    });

    const data = (await response.json()) as { orgId?: string; info?: { keyspaces?: string[] } };
    const keyspaces = data.info?.keyspaces ?? [];
    // The Astra portal needs the org in the URL (without it the page is a 404).
    const consoleBaseUrl = data.orgId
      ? `https://astra.datastax.com/org/${data.orgId}/database/${dbId}/api-console`
      : null;
    return { keyspaces, consoleBaseUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to list keyspaces: ${message}` };
  }
}

export async function listCollections(
  keyspace: string,
  calls?: DataApiCallInfo[],
): Promise<{ collections: CollectionDescriptor[] } | { error: string }> {
  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace });

    // Use listCollections with nameOnly: false to get full options (default)
    const listStart = performance.now();
    const collections = await db.listCollections();
    calls?.push({
      command: 'findCollections',
      method: 'POST',
      path: dataApiPath(keyspace),
      body: { findCollections: { options: { explain: true } } },
      ms: Math.round(performance.now() - listStart),
    });

    const descriptors: CollectionDescriptor[] = collections.map((col) => {
      const definition = col.definition ?? ({} as SDKCollectionDefinition<SomeDoc>);
      const capabilities = parseCapabilities(definition);
      return {
        ...col,
        capabilities,
      };
    });

    return { collections: descriptors };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to list collections: ${message}` };
  }
}

export async function listTables(
  keyspace: string
): Promise<{ tables: { name: string }[] } | { error: string }> {
  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace });

    const tables = await db.listTables();
    return { tables: tables.map((t) => ({ name: t.name })) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to list tables: ${message}` };
  }
}

// ─── Query / count ──────────────────────────────────────────────────────────

/** Typed error: a readable message plus a stable machine-readable code. */
export type ApiError = { error: string; errorCode: string };

export type QueryResult = {
  documents: Record<string, unknown>[];
  nextPageState: string | null;
  /** More documents exist after this page (heuristic for sorted queries). */
  hasNextPage: boolean;
  error?: string;
  errorCode?: string;
  /** The Data API calls made for this query; present when `includeTrace` is set. */
  calls?: DataApiCallInfo[];
};

export type CountResult = {
  count: number;
  isEstimate: boolean;
  isOver1000: boolean;
  error?: string;
  errorCode?: string;
  calls?: DataApiCallInfo[];
};

export type UpdateResult = {
  matchedCount: number;
  modifiedCount: number;
  error?: string;
  errorCode?: string;
  calls?: DataApiCallInfo[];
};

export type QueryOptions = {
  /** Data API projection. Defaults to `{ $vector: 0 }` (vector hidden). */
  projection?: Record<string, 0 | 1>;
  /** Inferred field types (used e.g. for dollarDate conversion). */
  fieldTypes?: Record<string, FieldType>;
  /** Include server-side execution trace for live tracing visualization. */
  includeTrace?: boolean;
};

const SORT_ROW_LIMIT_MESSAGE =
  'Too many documents match to sort (limit 10,000). Narrow your filter or remove the sort.';

/**
 * The Data API reports failures as HTTP 200 with `errors[]`. Maps the first
 * descriptor to a typed error; known codes get a friendlier message.
 */
export function mapDataApiErrors(
  errors: ReadonlyArray<{ errorCode?: string; message?: string }> | undefined,
): ApiError | null {
  const first = errors?.[0];
  if (!first) return null;
  const errorCode = first.errorCode ?? 'UNKNOWN';
  if (errorCode === 'OVERLOADED_SORT_ROW_LIMIT') {
    return { error: SORT_ROW_LIMIT_MESSAGE, errorCode };
  }
  return { error: first.message ?? `Data API error ${errorCode}`, errorCode };
}

/** Converts anything thrown by the SDK into a typed error (generic fallback `QUERY_FAILED`). */
async function toApiError(err: unknown, prefix: string): Promise<ApiError> {
  const { DataAPIResponseError } = await import('@datastax/astra-db-ts');
  if (err instanceof DataAPIResponseError) {
    const mapped = mapDataApiErrors(err.errorDescriptors);
    if (mapped) return mapped;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return { error: `${prefix}: ${message}`, errorCode: 'QUERY_FAILED' };
}

/**
 * Looks up one collection's capabilities (the Data API has no single-collection describe).
 * Returns null when the collection does not exist or the lookup fails.
 */
export async function getCollectionCapabilities(
  keyspace: string,
  collection: string,
  calls?: DataApiCallInfo[],
): Promise<CollectionCapabilities | null> {
  const result = await listCollections(keyspace, calls);
  if ('error' in result) return null;
  return result.collections.find((c) => c.name === collection)?.capabilities ?? null;
}

/**
 * Reads one document's stored `$vector` ("find similar" source). The vector is projected
 * out of normal results, so it must be fetched explicitly. Returns an ApiError when the
 * document or its vector is missing.
 */
async function lookupVector(
  keyspace: string,
  collection: string,
  id: DocId,
  calls?: DataApiCallInfo[],
): Promise<{ vector: number[] } | ApiError> {
  const { DataAPIClient } = await import('@datastax/astra-db-ts');
  const client = new DataAPIClient(TOKEN);
  const db = client.db(ENDPOINT, { keyspace });
  const response = await timedCommand(db, calls, keyspace, collection, {
    findOne: { filter: { _id: id }, projection: { $vector: 1 } },
  });
  const apiError = mapDataApiErrors(response.errors);
  if (apiError) return apiError;

  const document = (response.data as { document?: { $vector?: unknown } | null } | undefined)
    ?.document;
  if (!document) {
    return { error: 'The source document for "Find similar" was not found.', errorCode: 'SIMILAR_SOURCE_NOT_FOUND' };
  }
  const raw = document.$vector;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((n) => typeof n === 'number')) {
    return { error: 'The source document has no $vector to search with.', errorCode: 'SIMILAR_SOURCE_NO_VECTOR' };
  }
  return { vector: raw as number[] };
}

/**
 * Search-mode query (semantic / keyword / hybrid). One page of up to `searchLimit`
 * results in relevance order: no skip, no pageState, and `spec.sort` is deliberately NOT
 * sent (the Data API cannot combine a field sort with vector/lexical ranking; the grid
 * sorts the loaded results locally).
 */
async function searchQuery(spec: QuerySpec, options: QueryOptions): Promise<QueryResult> {
  const calls: DataApiCallInfo[] = [];
  const callsOut = () => (options.includeTrace ? calls : undefined);
  const fail = (e: ApiError): QueryResult => ({
    documents: [],
    nextPageState: null,
    hasNextPage: false,
    ...e,
    calls: callsOut(),
  });

  try {
    const caps = await getCollectionCapabilities(spec.keyspace, spec.collection, calls);
    if (!caps) {
      return fail({
        error: `Collection "${spec.collection}" was not found in keyspace "${spec.keyspace}".`,
        errorCode: 'COLLECTION_NOT_FOUND',
      });
    }
    const issues = validateSearch(spec, caps);
    if (issues.length > 0) {
      return fail({ error: issues.map((i) => i.message).join(' '), errorCode: issues[0].code });
    }

    let vector: number[] | null = null;
    if (spec.searchMode === 'semantic' && spec.similarTo !== null) {
      const found = await lookupVector(spec.keyspace, spec.collection, spec.similarTo, calls);
      if ('error' in found) return fail(found);
      vector = found.vector;
    }

    const request = compileSearch(spec, {
      fieldTypes: options.fieldTypes,
      projection: options.projection,
      vector,
      vectorize: canVectorizeText(caps),
    });
    if (!request) {
      return fail({ error: 'Nothing to search for.', errorCode: 'SEARCH_TEXT_REQUIRED' });
    }

    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace: spec.keyspace });
    const response = await timedCommand(db, calls, spec.keyspace, spec.collection, {
      [request.command]: request.body,
    });

    const apiError = mapDataApiErrors(response.errors);
    if (apiError) return fail(apiError);

    const data = response.data as { documents?: Record<string, unknown>[] } | undefined;
    let documents = data?.documents ?? [];
    if (request.command === 'findAndRerank') {
      const status = response.status as { documentResponses?: unknown } | undefined;
      documents = mergeRerankScores(documents, status?.documentResponses);
    }
    return { documents, nextPageState: null, hasNextPage: false, calls: callsOut() };
  } catch (err) {
    return fail(await toApiError(err, 'Failed to search collection'));
  }
}

/**
 * Browse-mode query. Uses the raw `find` command (via `db.command`) rather than
 * the cursor API so that `nextPageState` can be returned across stateless requests.
 *
 * Unsorted: pages with `pageState`. Sorted: pages with `skip`/`limit` — the Data API
 * rejects `pageState` together with `sort` and returns no `nextPageState`, and only
 * sorts the first {@link SORT_MAX_DOCUMENTS} matching documents.
 * Filter / search are wired in later phases.
 */
export async function query(spec: QuerySpec, options: QueryOptions = {}): Promise<QueryResult> {
  if (spec.searchMode !== 'browse') return searchQuery(spec, options);

  const calls: DataApiCallInfo[] = [];
  const callsOut = () => (options.includeTrace ? calls : undefined);
  const sorted = spec.sort.length > 0;
  const skip = spec.pageIndex * spec.pageSize;

  if (sorted && skip + spec.pageSize > SORT_MAX_DOCUMENTS) {
    return {
      documents: [],
      nextPageState: null,
      hasNextPage: false,
      errorCode: 'SORT_PAGE_BEYOND_LIMIT',
      error: `Sorted results are limited to the first ${SORT_MAX_DOCUMENTS.toLocaleString('en-US')} documents. Go to an earlier page or narrow your filter.`,
      calls: callsOut(),
    };
  }

  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace: spec.keyspace });

    const findOptions: Record<string, unknown> = sorted
      ? { limit: spec.pageSize, skip }
      : { limit: spec.pageSize, pageState: spec.pageState ?? undefined };

    const filterDoc = buildFindFilter(spec, options.fieldTypes);
    const sortDoc = sorted ? compileSort(spec.sort) : undefined;

    const response = await timedCommand(db, calls, spec.keyspace, spec.collection, {
      find: {
        filter: filterDoc,
        ...(sortDoc ? { sort: sortDoc } : {}),
        projection: options.projection ?? { $vector: 0 },
        options: findOptions,
      },
    });

    const apiError = mapDataApiErrors(response.errors);
    if (apiError) {
      return {
        documents: [],
        nextPageState: null,
        hasNextPage: false,
        ...apiError,
        calls: callsOut(),
      };
    }

    const data = response.data as
      | { documents?: Record<string, unknown>[]; nextPageState?: string | null }
      | undefined;
    const documents = data?.documents ?? [];
    const nextPageState = sorted ? null : (data?.nextPageState ?? null);
    return {
      documents,
      nextPageState,
      hasNextPage: sorted ? documents.length === spec.pageSize : nextPageState !== null,
      calls: callsOut(),
    };
  } catch (err) {
    const apiError = await toApiError(err, 'Failed to query collection');
    return {
      documents: [],
      nextPageState: null,
      hasNextPage: false,
      ...apiError,
      calls: callsOut(),
    };
  }
}

/**
 * Count documents matching the spec. In search modes this is the number of returned
 * results (never `countDocuments`); the explorer UI derives that from the query response
 * and does not call this, so a search is not executed twice.
 * Uses exact `countDocuments` with upperBound=1000 when a filter is present,
 * or fast `estimatedDocumentCount` when unfiltered.
 */
export async function count(
  spec: QuerySpec,
  options?: { fieldTypes?: Record<string, FieldType>; includeTrace?: boolean },
): Promise<CountResult> {
  const calls: DataApiCallInfo[] = [];
  const callsOut = () => (options?.includeTrace ? calls : undefined);
  // Search modes never call countDocuments: the count is the number of returned results.
  if (spec.searchMode !== 'browse') {
    const result = await query(spec, options);
    if (result.error) {
      return {
        count: 0,
        isEstimate: false,
        isOver1000: false,
        error: result.error,
        errorCode: result.errorCode,
        calls: result.calls,
      };
    }
    return { count: result.documents.length, isEstimate: false, isOver1000: false, calls: result.calls };
  }

  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace: spec.keyspace });

    const hasFilter = spec.filter && spec.filter.children.length > 0;
    if (hasFilter) {
      const filterDoc = buildFindFilter(spec, options?.fieldTypes);
      const response = await timedCommand(db, calls, spec.keyspace, spec.collection, {
        // No `options`: this Data API rejects any options on countDocuments.
        // The count is capped server-side at 1000; `moreData` signals "1,000+".
        countDocuments: {
          filter: filterDoc,
        },
      });

      const apiError = mapDataApiErrors(response.errors);
      if (apiError) {
        return {
          count: 0,
          isEstimate: false,
          isOver1000: false,
          error: apiError.error,
          calls: callsOut(),
        };
      }

      const status = response.status as { count?: number; moreData?: boolean } | undefined;
      return {
        count: status?.count ?? 0,
        isEstimate: false,
        isOver1000: status?.moreData ?? false,
        calls: callsOut(),
      };
    }

    const estimateStart = performance.now();
    const n = await db.collection(spec.collection).estimatedDocumentCount();
    calls.push({
      command: 'estimatedDocumentCount',
      method: 'POST',
      path: dataApiPath(spec.keyspace, spec.collection),
      body: { estimatedDocumentCount: {} },
      ms: Math.round(performance.now() - estimateStart),
    });
    return { count: n, isEstimate: true, isOver1000: false, calls: callsOut() };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      count: 0,
      isEstimate: false,
      isOver1000: false,
      error: `Failed to count documents: ${message}`,
      calls: callsOut(),
    };
  }
}

/**
 * Updates a single document field in Astra DB using updateOne.
 */
export async function updateDocumentField(
  keyspace: string,
  collection: string,
  id: DocId,
  field: string,
  value: unknown,
  options?: { includeTrace?: boolean },
): Promise<UpdateResult> {
  const calls: DataApiCallInfo[] = [];
  const callsOut = () => (options?.includeTrace ? calls : undefined);

  if (field === '_id' || field.startsWith('_id.') || field.startsWith('_id/')) {
    return {
      matchedCount: 0,
      modifiedCount: 0,
      error: 'The _id field is immutable and cannot be updated.',
      errorCode: 'CANNOT_UPDATE_ID',
      calls: callsOut(),
    };
  }

  if (field === '$similarity') {
    return {
      matchedCount: 0,
      modifiedCount: 0,
      error: 'The $similarity field is a synthetic search score and cannot be updated.',
      errorCode: 'READ_ONLY_FIELD',
      calls: callsOut(),
    };
  }

  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace });

    const response = await timedCommand(db, calls, keyspace, collection, {
      updateOne: {
        filter: { _id: id },
        update: {
          $set: {
            [field]: value,
          },
        },
      },
    });

    const apiError = mapDataApiErrors(response.errors);
    if (apiError) {
      return {
        matchedCount: 0,
        modifiedCount: 0,
        error: apiError.error,
        errorCode: apiError.errorCode,
        calls: callsOut(),
      };
    }

    const status = response.status as { matchedCount?: number; modifiedCount?: number } | undefined;
    return {
      matchedCount: status?.matchedCount ?? 1,
      modifiedCount: status?.modifiedCount ?? 1,
      calls: callsOut(),
    };
  } catch (err) {
    const apiError = await toApiError(err, 'Failed to update document');
    return {
      matchedCount: 0,
      modifiedCount: 0,
      error: apiError.error,
      errorCode: apiError.errorCode,
      calls: callsOut(),
    };
  }
}
