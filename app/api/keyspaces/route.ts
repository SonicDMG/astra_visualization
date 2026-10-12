import { NextResponse } from 'next/server';
import { listKeyspaces } from '@/lib/astra/gateway';

export async function GET(): Promise<NextResponse> {
  const result = await listKeyspaces();
  return NextResponse.json(result);
}