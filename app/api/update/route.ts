import { NextRequest, NextResponse } from 'next/server';
import { updateDocumentField } from '@/lib/astra/gateway';
import { statusForErrorCode } from '@/lib/astra/errors';
import { isDocId } from '@/lib/query/types';
import { isFieldEditable } from '@/lib/astra/schema';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      keyspace?: string;
      collection?: string;
      id?: unknown;
      field?: string;
      value?: unknown;
      trace?: boolean;
    };

    const { keyspace, collection, id, field, value, trace } = body;

    if (!keyspace || !collection) {
      return NextResponse.json(
        { error: 'Missing required parameters: keyspace and collection.' },
        { status: 400 },
      );
    }

    if (!isDocId(id)) {
      return NextResponse.json(
        { error: 'Invalid or missing document ID (_id).' },
        { status: 400 },
      );
    }

    if (!field || typeof field !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid field name.' },
        { status: 400 },
      );
    }

    const { editable, reason } = isFieldEditable(field);
    if (!editable) {
      return NextResponse.json(
        { error: reason ?? `Field "${field}" cannot be edited.` },
        { status: 400 },
      );
    }

    const result = await updateDocumentField(keyspace, collection, id, field, value, {
      includeTrace: Boolean(trace),
    });

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
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      ...(result.calls ? { calls: result.calls } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return NextResponse.json(
      { error: `Update failed: ${message}` },
      { status: 500 },
    );
  }
}
