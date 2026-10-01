import { NextResponse } from 'next/server';
import { db, getRubric } from '@/lib/db';
import { fileToText } from '@/lib/parse';
import { splitPII } from '@/lib/pii';
import { scoreCandidate } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const role = form.get('role');
    const nameOverride = form.get('name') || '';
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file' }, { status: 400 });
    if (!['PM', 'SPM'].includes(role)) return NextResponse.json({ error: 'Role must be PM or SPM' }, { status: 400 });

    // 1. Read the CV and split personal details from content (no AI)
    const raw = await fileToText(file);
    if (!raw || raw.trim().length < 50) throw new Error('Could not read text from this file (scanned image?)');
    const { pii, content } = splitPII(raw, file.name, nameOverride);

    // 2. Store: content and PII in separate tables
    const { data: cand, error } = await db().from('candidates')
      .insert({ applied_role: role, source_filename: file.name, cv_content: content })
      .select().single();
    if (error) throw error;
    const { error: piiErr } = await db().from('candidate_pii').insert({ candidate_id: cand.id, ...pii });
    if (piiErr) throw piiErr;

    // 3. Score against BOTH rubrics (redacted content only)
    try {
      const rubric = await getRubric();
      const scores = await scoreCandidate(content, rubric);
      await db().from('candidates').update({
        scores, pm_score: scores.PM.total, spm_score: scores.SPM.total, status: 'scored', error: null,
      }).eq('id', cand.id);
      return NextResponse.json({ id: cand.id, name: pii.name, PM: scores.PM.total, SPM: scores.SPM.total });
    } catch (e) {
      await db().from('candidates').update({ status: 'error', error: String(e.message || e).slice(0, 500) }).eq('id', cand.id);
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
