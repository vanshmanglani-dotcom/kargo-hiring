import { db, getRubric } from './db';
import { geminiJSON } from './gemini';
import { aiMode, demoScore, demoDraft } from './demo';

const ROLE_LABEL = { PM: 'Product Manager', SPM: 'Senior Product Manager' };

const rubricText = (criteria) =>
  criteria.map((c) => `- id: "${c.position}" | ${c.name} (weight ${c.weight}%)\n  Strong looks like: ${c.description}`).join('\n');

// ---------- Step 1: score against BOTH rubrics ----------
const CRIT_LIST = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { id: { type: 'STRING' }, score: { type: 'INTEGER' }, reason: { type: 'STRING' } },
    required: ['id', 'score', 'reason'],
  },
};
const SCORE_SCHEMA = {
  type: 'OBJECT',
  properties: { PM: CRIT_LIST, SPM: CRIT_LIST, years_experience: { type: 'NUMBER' } },
  required: ['PM', 'SPM', 'years_experience'],
};

async function aiScore(content, rubric) {
  const prompt = `You are scoring a CV for Kargo, a Series A logistics SaaS startup in Mumbai (freight forwarders, 3PLs).
Score the CV against BOTH rubrics below. For every criterion give an integer score 1-5 and ONE short sentence of reason
that cites concrete evidence from the CV (or says what is missing). Score strictly from what is written; do not reward
job titles, years of experience or buzzwords. Personal details have been removed and appear as [NAME]/[EMAIL]/[PHONE].

PM RUBRIC:
${rubricText(rubric.PM)}

SPM RUBRIC (higher bar):
${rubricText(rubric.SPM)}

CV:
"""
${content.slice(0, 20000)}
"""

Return JSON: {"PM":[{"id","score","reason"}...], "SPM":[...], "years_experience": <total years of full-time work experience, number>} with one entry per criterion id.`;

  const out = await geminiJSON(prompt, SCORE_SCHEMA);
  const build = (role) => {
    const criteria = rubric[role].map((c) => {
      const hit = (out[role] || []).find((x) => String(x.id) === String(c.position)) || {};
      const score = Math.min(5, Math.max(1, Number(hit.score) || 1));
      return { name: c.name, weight: c.weight, score, reason: hit.reason || 'No evidence found.' };
    });
    const total = Math.round(criteria.reduce((s, c) => s + (c.weight * c.score) / 5, 0) * 10) / 10;
    return { total, criteria };
  };
  return { PM: build('PM'), SPM: build('SPM'), years: Number(out.years_experience) || null, engine: 'ai' };
}

// ---------- Steps 2+3: brief (shortlist only) + email draft ----------
const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: { brief: { type: 'STRING' }, subject: { type: 'STRING' }, body: { type: 'STRING' } },
  required: ['subject', 'body'],
};

async function aiDraft(candidate, decision) {
  const role = candidate.applied_role;
  const s = candidate.scores[role];
  const breakdown = s.criteria.map((c) => `- ${c.name}: ${c.score}/5 — ${c.reason}`).join('\n');
  const invite = decision === 'invite';

  const prompt = `You support Arjun Mehta, founder of Kargo (Series A logistics SaaS, Mumbai). A candidate applied for ${ROLE_LABEL[role]}.
Score ${s.total}/100. Breakdown:
${breakdown}

Redacted CV:
"""
${candidate.cv_content.slice(0, 12000)}
"""

${invite ? `1. "brief": an interview brief for Arjun, EXACTLY three sentences: (1) who this person is professionally, (2) why they ranked high — the strongest evidence, (3) the single most important thing to probe in the interview (the weakest criterion).` : '1. "brief": empty string.'}
2. "subject" and "body": an email from Arjun to the candidate. ${invite
    ? 'Invite them to a 45-minute interview at Kargo for the role. Reference one or two specific things from their CV that stood out. Ask them to reply with two or three time slots that work next week.'
    : 'A warm, respectful rejection. Thank them, mention one specific genuine strength from their CV, say clearly that Kargo will not be moving forward for this role right now, and wish them well. Do not list weaknesses or give scores. Do not promise future roles.'}
Rules: start the body with "Hi [NAME]," — always use the literal placeholder [NAME], never guess a name. Plain text, under 150 words, sign off as "Arjun Mehta\\nFounder, Kargo". No markdown.`;

  const out = await geminiJSON(prompt, DRAFT_SCHEMA, { temperature: 0.4 });
  return { brief: invite ? (out.brief || '').trim() : null, subject: out.subject.trim(), body: out.body.trim() };
}

// Public entry points: use the AI when a key is configured; if the AI call fails for any reason
// (bad key, quota, gateway needs a card…), fall back to the rule-based demo engine so the app keeps working.
export async function scoreCandidate(content, rubric) {
  if (aiMode() === 'demo') return demoScore(content, rubric);
  try { return await aiScore(content, rubric); }
  catch (e) { return { ...demoScore(content, rubric), fallback: String(e.message || e).slice(0, 200) }; }
}

export async function draftFor(candidate, decision) {
  if (aiMode() === 'demo') return demoDraft(candidate, decision);
  try { return await aiDraft(candidate, decision); }
  catch { return demoDraft(candidate, decision); }
}

// ---------- Ranking + drafting pass ----------
// Decides invite/reject per role (top SHORTLIST_SIZE by applied-role score), unless the founder overrode it,
// then (re)drafts any unsent candidate whose draft doesn't match their decision. Processes `limit` drafts per call
// so it fits inside serverless time limits; the client calls it in a loop until remaining = 0.
export async function recompute(limit = 4) {
  const N = Number(process.env.SHORTLIST_SIZE || 5);
  const { data: all, error } = await db().from('candidates').select('*').not('scores', 'is', null);
  if (error) throw error;

  const updates = [];
  for (const role of ['PM', 'SPM']) {
    const ranked = all
      .filter((c) => c.applied_role === role)
      .sort((a, b) => (b.scores[role].total - a.scores[role].total));
    ranked.forEach((c, i) => {
      if (c.decision_source === 'founder' || c.status === 'sent') return;
      const want = i < N ? 'invite' : 'reject';
      if (c.decision !== want) { c.decision = want; updates.push({ id: c.id, decision: want }); }
    });
  }
  for (const u of updates) await db().from('candidates').update({ decision: u.decision }).eq('id', u.id);

  const todo = all.filter((c) => c.status !== 'sent' && c.status !== 'error' && c.decision && c.draft_for !== c.decision);
  const batch = todo.slice(0, limit);
  await Promise.all(batch.map(async (c) => {
    try {
      const d = await draftFor(c, c.decision);
      await db().from('candidates').update({
        brief: d.brief, email_subject: d.subject, email_body: d.body, draft_for: c.decision, status: 'drafted', error: null,
      }).eq('id', c.id);
    } catch (e) {
      await db().from('candidates').update({ status: 'error', error: String(e.message || e).slice(0, 500) }).eq('id', c.id);
    }
  }));
  return { processed: batch.length, remaining: Math.max(0, todo.length - batch.length) };
}

export { getRubric };
