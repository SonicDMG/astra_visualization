import { NextRequest, NextResponse } from 'next/server';
import { listCollections, listTables } from '@/lib/astra/gateway';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const keyspace = searchParams.get('keyspace');

  if (!keyspace) {
    return NextResponse.json(
      { error: 'Missing required query parameter: keyspace' },
      { status: 400 }
    );
  }

  const [collectionsResult, tablesResult] = await Promise.all([
    listCollections(keyspace),
    listTables(keyspace),
  ]);

  if ('error' in collectionsResult) {
    return NextResponse.json(collectionsResult, { status: 500 });
  }
  if ('error' in tablesResult) {
    return NextResponse.json(tablesResult, { status: 500 });
  }

  return NextResponse.json({
    collections: collectionsResult.collections,
    tables: tablesResult.tables,
  });
}