import { NextResponse } from 'next/server';
import { aiMode } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ai: aiMode(), email: process.env.RESEND_API_KEY ? 'resend' : 'demo' });
}
