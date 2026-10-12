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

// ─── Stub implementations ────────────────────────────────────────────────────

export async function listKeyspaces(): Promise<string[]> {
  throw new Error('not implemented');
}

export async function listCollections(_keyspace: string): Promise<string[]> {
  throw new Error('not implemented');
}

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
