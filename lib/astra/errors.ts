// Pure module: maps gateway error codes to HTTP statuses for the API routes.

/** Sort limits and filter problems are caller-correctable (422). */
const UNPROCESSABLE_CODES: ReadonlySet<string> = new Set([
  'OVERLOADED_SORT_ROW_LIMIT',
  'SORT_PAGE_BEYOND_LIMIT',
  'NON_INDEXED_FIELD',
  'TOO_MANY_IN_VALUES',
  'TOO_MANY_CONDITIONS',
  'MISSING_VALUE',
  'INVALID_DATE',
  // Data API rejections of the user's own query (seen live against walfly).
  'FILTER_PATH_UNINDEXED',
  'SORT_CLAUSE_PATH_UNINDEXED',
]);

/** Invalid search requests, pre-validated in the gateway before anything reaches Astra (400). */
const BAD_REQUEST_CODES: ReadonlySet<string> = new Set([
  'SEARCH_MODE_UNSUPPORTED',
  'SEARCH_TEXT_REQUIRED',
  'SEARCH_VECTOR_REQUIRED',
  'SEARCH_VECTOR_DIMENSION',
  'SEARCH_VECTORIZE_UNAVAILABLE',
]);

/** Missing collection or missing "Find similar" source (404). */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'COLLECTION_NOT_FOUND',
  'SIMILAR_SOURCE_NOT_FOUND',
  'SIMILAR_SOURCE_NO_VECTOR',
]);

/** HTTP status for a gateway error code; unknown or missing codes are server failures (500). */
export function statusForErrorCode(errorCode: string | undefined): number {
  if (!errorCode) return 500;
  if (BAD_REQUEST_CODES.has(errorCode)) return 400;
  if (NOT_FOUND_CODES.has(errorCode)) return 404;
  return UNPROCESSABLE_CODES.has(errorCode) ? 422 : 500;
}
