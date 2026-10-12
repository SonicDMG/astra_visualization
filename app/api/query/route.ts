import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/astra/gateway';
import { querySpecFromUrlParams } from '@/lib/query/types';

/** Sort limits are caller-correctable (422); everything else is a server failure (500). */
const CLIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'OVERLOADED_SORT_ROW_LIMIT',
  'SORT_PAGE_BEYOND_LIMIT',
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const keyspace = params.get('keyspace');
  const collection = params.get('collection');

  if (!keyspace || !collection) {
    return NextResponse.json(
      { error: 'Missing required query parameters: keyspace, collection' },
      { status: 400 },
    );
  }

  // `sv=1` opts in to the (large) $vector field. A bare `{ $vector: 1 }` would
  // turn the projection into an include-list, so include all other fields via `*`.
  const projection: Record<string, 0 | 1> | undefined =
    params.get('sv') === '1' ? { '*': 1, $vector: 1 } : undefined;

  const result = await query(querySpecFromUrlParams(params, keyspace, collection), { projection });
  if (result.error) {
    const status = result.errorCode && CLIENT_ERROR_CODES.has(result.errorCode) ? 422 : 500;
    return NextResponse.json(
      { error: result.error, ...(result.errorCode ? { errorCode: result.errorCode } : {}) },
      { status },
    );
  }
  return NextResponse.json({
    documents: result.documents,
    nextPageState: result.nextPageState,
    hasNextPage: result.hasNextPage,
  });
}
