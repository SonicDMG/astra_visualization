import { NextRequest, NextResponse } from 'next/server';
import { count } from '@/lib/astra/gateway';
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

  let fieldTypes: Record<string, FieldType> | undefined;
  const ftRaw = params.get('ft');
  if (ftRaw) {
    try {
      fieldTypes = JSON.parse(ftRaw);
    } catch {
      // Ignored: lenient parsing falls back to standard types
    }
  }

  const includeTrace = params.get('trace') === '1';

  const result = await count(spec, { fieldTypes, includeTrace });
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
    count: result.count,
    isEstimate: result.isEstimate,
    isOver1000: result.isOver1000,
    ...(result.calls ? { calls: result.calls } : {}),
  });
}
