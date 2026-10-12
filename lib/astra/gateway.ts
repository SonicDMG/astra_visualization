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
import { compileFilter, compileSort } from '@/lib/query/compile';
import { type QuerySpec, SORT_MAX_DOCUMENTS } from '@/lib/query/types';

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
  hasLexical: boolean;
  hasRerank: boolean;
  /** Collection `indexing` option; null = everything indexed. */
  indexing: { allow: string[] } | { deny: string[] } | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDbId(endpoint: string): string | null {
  const match = endpoint.match(/https:\/\/([^-]+)-[^.]+\.apps\.astra\.datastax\.com/);
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

// ─── Gateway functions ──────────────────────────────────────────────────────

export async function listKeyspaces(): Promise<{ keyspaces: string[] } | { error: string }> {
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

    const data = (await response.json()) as { info?: { keyspaces?: string[] } };
    const keyspaces = data.info?.keyspaces ?? [];
    return { keyspaces };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { error: `Failed to list keyspaces: ${message}` };
  }
}

export async function listCollections(
  keyspace: string
): Promise<{ collections: CollectionDescriptor[] } | { error: string }> {
  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace });

    // Use listCollections with nameOnly: false to get full options (default)
    const collections = await db.listCollections();

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
};

export type CountResult = {
  count: number;
  isEstimate: boolean;
  isOver1000: boolean;
  error?: string;
};

export type QueryOptions = {
  /** Data API projection. Defaults to `{ $vector: 0 }` (vector hidden). */
  projection?: Record<string, 0 | 1>;
  /** Inferred field types (used e.g. for dollarDate conversion). */
  fieldTypes?: Record<string, FieldType>;
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
 * Browse-mode query. Uses the raw `find` command (via `db.command`) rather than
 * the cursor API so that `nextPageState` can be returned across stateless requests.
 *
 * Unsorted: pages with `pageState`. Sorted: pages with `skip`/`limit` — the Data API
 * rejects `pageState` together with `sort` and returns no `nextPageState`, and only
 * sorts the first {@link SORT_MAX_DOCUMENTS} matching documents.
 * Filter / search are wired in later phases.
 */
export async function query(spec: QuerySpec, options: QueryOptions = {}): Promise<QueryResult> {
  const sorted = spec.sort.length > 0;
  const skip = spec.pageIndex * spec.pageSize;

  if (sorted && skip + spec.pageSize > SORT_MAX_DOCUMENTS) {
    return {
      documents: [],
      nextPageState: null,
      hasNextPage: false,
      errorCode: 'SORT_PAGE_BEYOND_LIMIT',
      error: `Sorted results are limited to the first ${SORT_MAX_DOCUMENTS.toLocaleString('en-US')} documents. Go to an earlier page or narrow your filter.`,
    };
  }

  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace: spec.keyspace });

    const findOptions: Record<string, unknown> = sorted
      ? { limit: spec.pageSize, skip }
      : { limit: spec.pageSize, pageState: spec.pageState ?? undefined };

    const filterDoc = compileFilter(spec.filter, options.fieldTypes);

    const response = await db.command(
      {
        find: {
          filter: filterDoc,
          ...(sorted ? { sort: compileSort(spec.sort) } : {}),
          projection: options.projection ?? { $vector: 0 },
          options: findOptions,
        },
      },
      { collection: spec.collection },
    );

    const apiError = mapDataApiErrors(response.errors);
    if (apiError) {
      return { documents: [], nextPageState: null, hasNextPage: false, ...apiError };
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
    };
  } catch (err) {
    const apiError = await toApiError(err, 'Failed to query collection');
    return { documents: [], nextPageState: null, hasNextPage: false, ...apiError };
  }
}

/**
 * Count documents matching the spec.
 * Uses exact `countDocuments` with upperBound=1000 when a filter is present,
 * or fast `estimatedDocumentCount` when unfiltered.
 */
export async function count(
  spec: QuerySpec,
  options?: { fieldTypes?: Record<string, FieldType> },
): Promise<CountResult> {
  try {
    const { DataAPIClient } = await import('@datastax/astra-db-ts');
    const client = new DataAPIClient(TOKEN);
    const db = client.db(ENDPOINT, { keyspace: spec.keyspace });

    const hasFilter = spec.filter && spec.filter.children.length > 0;
    if (hasFilter) {
      const filterDoc = compileFilter(spec.filter, options?.fieldTypes);
      const response = await db.command(
        {
          countDocuments: {
            filter: filterDoc,
            options: { upperBound: 1000 },
          },
        },
        { collection: spec.collection },
      );

      const apiError = mapDataApiErrors(response.errors);
      if (apiError) {
        return { count: 0, isEstimate: false, isOver1000: false, error: apiError.error };
      }

      const status = response.status as { count?: number; moreData?: boolean } | undefined;
      return {
        count: status?.count ?? 0,
        isEstimate: false,
        isOver1000: status?.moreData ?? false,
      };
    }

    const n = await db.collection(spec.collection).estimatedDocumentCount();
    return { count: n, isEstimate: true, isOver1000: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      count: 0,
      isEstimate: false,
      isOver1000: false,
      error: `Failed to count documents: ${message}`,
    };
  }
}
