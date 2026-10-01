import { NextResponse } from 'next/server';
import { db, getRubric } from '@/lib/db';
import { fileToText } from '@/lib/parse';
import { splitPII } from '@/lib/pii';
import { scoreCandidate } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Role from filename hints like "pm_03_..." / "spm_16_..." when the founder chose Auto-detect.
function roleHint(name) {
  if (/(^|[^a-z])spm[_\-\s]/i.test(name)) return 'SPM';
  if (/(^|[^a-z])pm[_\-\s]/i.test(name)) return 'PM';
  return null;
}

async function readInput(req) {
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const { driveId, filename, role, name } = await req.json();
    if (!driveId) throw new Error('No driveId');
    const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(driveId)}&export=download&confirm=t`);
    if (!res.ok) throw new Error(`Drive download failed (${res.status}) — is the file shared publicly?`);
    const file = new File([await res.arrayBuffer()], filename || `${driveId}.pdf`, { type: res.headers.get('content-type') || '' });
    return { file, role, nameOverride: name || '' };
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new Error('No file');
  return { file, role: form.get('role'), nameOverride: form.get('name') || '' };
}

export async function POST(req) {
  try {
    const { file, role: chosen, nameOverride } = await readInput(req);
    if (!['PM', 'SPM', 'AUTO'].includes(chosen)) throw new Error('Role must be PM, SPM or AUTO');

    const { data: dup } = await db().from('candidates').select('id, status').eq('source_filename', file.name);
    if (dup?.some((d) => d.status !== 'error')) return NextResponse.json({ skipped: true, name: file.name });
    if (dup?.length) await db().from('candidates').delete().in('id', dup.map((d) => d.id)); // re-try failed imports

    // 1. Read the CV and split personal details from content (no AI)
    // strip NUL bytes / lone surrogates that some PDFs contain — Postgres rejects them
    const raw = (await fileToText(file) || '').replace(/\u0000/g, '').replace(/[\uD800-\uDFFF]/g, '');
    if (!raw || raw.trim().length < 50) throw new Error('Could not read text from this file (scanned image?)');
    const { pii, content } = splitPII(raw, file.name, nameOverride);

    // 2. Store content and PII in separate tables
    let role = chosen === 'AUTO' ? roleHint(file.name) : chosen;
    const { data: cand, error } = await db().from('candidates')
      .insert({ applied_role: role || 'PM', source_filename: file.name, cv_content: content })
      .select().single();
    if (error) throw error;
    const { error: piiErr } = await db().from('candidate_pii').insert({ candidate_id: cand.id, ...pii });
    if (piiErr) throw piiErr;

    // 3. Score against BOTH rubrics (redacted content only)
    try {
      const rubric = await getRubric();
      const scores = await scoreCandidate(content, rubric);
      // Auto-detect without a filename hint: JD bands — PM 2–4 yrs, SPM 5–8 yrs.
      if (!role) role = scores.years >= 5 ? 'SPM' : 'PM';
      await db().from('candidates').update({
        applied_role: role, scores, pm_score: scores.PM.total, spm_score: scores.SPM.total, status: 'scored', error: null,
      }).eq('id', cand.id);
      return NextResponse.json({ id: cand.id, name: pii.name, role, PM: scores.PM.total, SPM: scores.SPM.total });
    } catch (e) {
      await db().from('candidates').update({ status: 'error', error: String(e.message || e).slice(0, 500) }).eq('id', cand.id);
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
