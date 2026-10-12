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

// Re-export the parseCapabilities function for the schema module
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
    hasLexical: !!definition.lexical?.enabled,
    hasRerank: !!rerank?.enabled,
  };
}

// ─── Stubs for Phase 3+ ─────────────────────────────────────────────────────

export async function query(
  _keyspace: string,
  _collection: string,
  _filter: Record<string, unknown>,
): Promise<unknown[]> {
  throw new Error('not implemented');
}

export async function count(
  _keyspace: string,
  _collection: string,
  _filter: Record<string, unknown>,
): Promise<number> {
  throw new Error('not implemented');
}