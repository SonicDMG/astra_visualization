import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/astra/gateway';
import { statusForErrorCode } from '@/lib/astra/errors';
import { querySpecFromUrlParams } from '@/lib/query/types';
import { validateFilter } from '@/lib/query/compile';
import type { FieldType } from '@/lib/astra/schema';

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

  const spec = querySpecFromUrlParams(params, keyspace, collection);

  // Validate filter before execution
  const filterIssues = validateFilter(spec.filter);
  if (filterIssues.length > 0) {
    return NextResponse.json(
      {
        error: filterIssues.map((i) => i.message).join('; '),
        errorCode: filterIssues[0].code,
      },
      { status: 400 },
    );
  }

  // Optional client-provided field types (e.g. for dollarDate handling)
  let fieldTypes: Record<string, FieldType> | undefined;
  const ftRaw = params.get('ft');
  if (ftRaw) {
    try {
      fieldTypes = JSON.parse(ftRaw);
    } catch {
      // Ignored: lenient parsing falls back to standard types
    }
  }

  // `sv=1` opts in to the (large) $vector field. A bare `{ $vector: 1 }` would
  // turn the projection into an include-list, and the Data API rejects `*` combined
  // with other paths, so `{ '*': 1 }` alone (which also returns $vector) is used.
  const projection: Record<string, 0 | 1> | undefined =
    params.get('sv') === '1' ? { '*': 1 } : undefined;

  const includeTrace = params.get('trace') === '1';

  const result = await query(spec, { projection, fieldTypes, includeTrace });
  if (result.error) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(result.calls ? { calls: result.calls } : {}),
      },
      { status: statusForErrorCode(result.errorCode) },
    );
  }
  return NextResponse.json({
    documents: result.documents,
    nextPageState: result.nextPageState,
    hasNextPage: result.hasNextPage,
    ...(result.calls ? { calls: result.calls } : {}),
  });
}
