import { NextResponse } from 'next/server';
import { db, getRubric } from '@/lib/db';
import { scoreCandidate } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Founder actions: override decision, save edited draft, retry a failed step, delete.
export async function POST(req) {
  try {
    const { id, action, subject, body } = await req.json();
    const t = db().from('candidates');
    if (action === 'invite' || action === 'reject') {
      await t.update({ decision: action, decision_source: 'founder' }).eq('id', id).neq('status', 'sent');
    } else if (action === 'save') {
      await t.update({ email_subject: subject, email_body: body }).eq('id', id);
    } else if (action === 'retry') {
      const { data: c } = await t.select('*').eq('id', id).single();
      if (!c.scores) {
        const scores = await scoreCandidate(c.cv_content, await getRubric());
        await db().from('candidates').update({ scores, pm_score: scores.PM.total, spm_score: scores.SPM.total, status: 'scored', error: null, draft_for: null }).eq('id', id);
      } else {
        await db().from('candidates').update({ status: 'scored', error: null, draft_for: null }).eq('id', id);
      }
    } else if (action === 'redraft') {
      await t.update({ draft_for: null }).eq('id', id).neq('status', 'sent');
    } else if (action === 'delete') {
      await t.delete().eq('id', id);
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
