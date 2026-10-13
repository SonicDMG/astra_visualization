/** Where a step runs. */
export type StepWhere = 'browser' | 'server' | 'astra';

export type TraceStatus = 'active' | 'ok' | 'blocked' | 'error';

/**
 * Where a query/sort was actually handled:
 * - `local`: in the browser from rows already loaded; no request to Astra.
 * - `astra-memory`: Astra loaded the matching documents (up to 10,000) and sorted them in memory.
 * - `astra-live`: Astra read the data directly (unsorted find, or vector/keyword/hybrid search).
 * - `blocked`: nothing ran; the click was refused (e.g. the column is not sortable).
 */
export type TraceHandling = 'local' | 'astra-memory' | 'astra-live' | 'blocked';

/** `header-click`: started by ResultsGrid, continued by ExplorerState. `query`: started by ExplorerState. */
export type TraceRunSource = 'header-click' | 'query';

/**
 * One real Data API call made by the app server on the user's behalf. The body is exactly what
 * was sent (long vectors are shortened); the token is never included.
 */
export interface DataApiCallInfo {
  /** The Data API command name, e.g. `find`, `findAndRerank`, `countDocuments`. */
  command: string;
  method: 'POST';
  /** Path under `ASTRA_DB_API_ENDPOINT`, e.g. `/api/json/v1/default_keyspace/recordings`. */
  path: string;
  body: unknown;
  ms: number;
  failed?: boolean;
}

export interface TraceStep {
  where: StepWhere;
  status: TraceStatus;
  timestamp: number;
  /** Milliseconds since the run started. */
  elapsedMs: number;
  /** How long this step itself took, when known. */
  durationMs?: number;
  label: string;
  detail?: string;
  /** Endpoint shown in the box, e.g. `GET /api/query?so=title:asc` or `POST /api/json/v1/ks/coll`. */
  endpoint?: string;
  /** Set on steps that are a Data API call; the full body is shown when the box is selected. */
  call?: DataApiCallInfo;
}

export interface SortFieldSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export interface TraceRun {
  id: string;
  timestamp: number;
  /** What the user did, e.g. `Clicked "status" header` or `Keyword search · page 3`. */
  trigger: string;
  handling: TraceHandling;
  /** One plain-language sentence saying why it was handled this way. */
  reason: string;
  /** For sorted pages: how many rows Astra has to order to serve this page. */
  paging?: string;
  sortSpec: SortFieldSpec[];
  searchMode: string;
  outcome: 'ok' | 'blocked' | 'error';
  totalMs: number;
  steps: TraceStep[];
  /** Index of the step still in flight (or being replayed); null once the run is finished. */
  activeStepIndex: number | null;
  errorDetail?: string;
}
