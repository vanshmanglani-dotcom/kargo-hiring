import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const fill = (s, name) => (s || '').replaceAll('[NAME]', name.split(' ')[0]);

// The ONLY place an email leaves the system — triggered by the founder clicking Send.
export async function POST(req) {
  try {
    const { id, subject, body } = await req.json();
    const key = process.env.RESEND_API_KEY;

    const { data: c, error } = await db().from('candidates').select('*, candidate_pii(name, email)').eq('id', id).single();
    if (error) throw error;
    if (c.status === 'sent') throw new Error('Already sent');
    const p = Array.isArray(c.candidate_pii) ? c.candidate_pii[0] : c.candidate_pii;
    if (!p?.email) throw new Error('No email address found on this CV');

    const subj = fill(subject ?? c.email_subject, p.name);
    const text = fill(body ?? c.email_body, p.name);
    if (!subj || !text) throw new Error('Draft is empty');

    // Demo mode: no Resend key → record the send without emailing anyone.
    if (!key) {
      await db().from('candidates').update({
        status: 'sent', sent_at: new Date().toISOString(), resend_id: 'demo-not-emailed',
        email_subject: subject ?? c.email_subject, email_body: body ?? c.email_body,
      }).eq('id', id);
      return NextResponse.json({ ok: true, to: p.email, demo: true });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Kargo <onboarding@resend.dev>', to: [p.email], subject: subj, text }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(`Resend: ${out.message || res.status}`);

    await db().from('candidates').update({
      status: 'sent', sent_at: new Date().toISOString(), resend_id: out.id,
      email_subject: subject ?? c.email_subject, email_body: body ?? c.email_body,
    }).eq('id', id);
    return NextResponse.json({ ok: true, to: p.email, resend_id: out.id });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
