import { NextResponse } from 'next/server';
import { recompute } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  try {
    return NextResponse.json(await recompute(4));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
