import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/astra/gateway';
import { querySpecFromUrlParams } from '@/lib/query/types';

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
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    documents: result.documents,
    nextPageState: result.nextPageState,
  });
}
