import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data, error } = await db().from('candidates')
      .select('id, created_at, applied_role, source_filename, scores, pm_score, spm_score, decision, decision_source, brief, email_subject, email_body, draft_for, status, sent_at, error, candidate_pii(name, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = data.map(({ candidate_pii, ...c }) => {
      const p = Array.isArray(candidate_pii) ? candidate_pii[0] : candidate_pii;
      return { ...c, name: p?.name || 'Candidate', email: p?.email || null };
    });
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
