// DEMO ENGINE — used when no AI key is configured. Rule-based, deterministic, runs on our server.
// Scores the same rubric by looking for evidence phrases in the (redacted) CV, and writes
// brief/email drafts from templates. Swap in a real model by setting GEMINI_API_KEY.

export function aiMode() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.AI_GATEWAY_API_KEY || process.env.USE_AI_GATEWAY === '1') return 'gateway';
  return 'demo';
}

// Evidence signals per criterion position (1..5), matching rubric.txt
const SIGNALS = {
  1: [/freight/i, /logistic/i, /customs/i, /shipment/i, /carrier/i, /warehous/i, /\b3pl\b/i, /\bport\b/i, /\bcha\b/i,
      /supply chain/i, /dispatch/i, /fleet/i, /last[- ]mile/i, /bill of lading|\bb\/l\b/i, /container/i, /trucking|transport/i,
      /operations (executive|analyst|manager|associate)/i, /on[- ]ground|field (ops|operations|visits?)/i, /cargo/i, /exim|export|import/i],
  2: [/(built|created|designed|set up|introduced|started|launched|wrote) [^.]{0,80}(adopted|now used|became (the )?(team )?standard|rolled out|used by \d+|kept permanently|across the)/i,
      /\badopted by\b/i, /without being asked|on (my|her|his) own|self[- ]initiated|unprompted|side project/i,
      /over a weekend/i, /from scratch/i, /prototype/i, /first[- ]ever|for the first time/i, /internal tool/i],
  3: [/\bkill(ed|ing)?\b/i, /sunset|deprecated|shut down/i, /post[- ]?mortem/i, /retro(spective)?/i, /root cause/i,
      /\b(lost|failed|failure)\b/i, /learn(ed|ings)/i, /pivot/i, /did not (buy|work)|didn.t work/i, /reversed/i],
  4: [/\bsole\b/i, /only (pm|product manager)/i, /first (pm|product manager|product hire)/i, /independently/i,
      /end[- ]to[- ]end/i, /\bowned?\b|ownership/i, /report(s|ed|ing)? (directly )?to (the )?(ceo|founder|cto)/i,
      /no (manager|senior pm|layer)/i, /founding/i, /(made|making) (the )?(call|decision)/i, /full ownership/i],
  5: [/outage/i, /incident/i, /overnight|through the night|7pm|midnight/i, /deadline|time pressure/i,
      /same[- ]day|within (24|48) hours|within hours/i, /escalat/i, /crisis|emergency/i, /on[- ]call|\bp1\b/i,
      /zero (downtime|data loss|delays)/i, /hold\b|held up/i],
};

const LABEL = { 1: 'operations exposure', 2: 'self-started fixes', 3: 'owning failures', 4: 'independent ownership', 5: 'pressure handling' };

function evidence(content, pos) {
  const hits = [];
  for (const re of SIGNALS[pos]) {
    // widen the match to whole words so reasons read naturally ("logistics", not "logistic")
    const m = content.match(new RegExp(`\\w*(?:${re.source})\\w*`, 'i'));
    if (m) hits.push(m[0].trim().slice(0, 40));
  }
  return [...new Set(hits.map((h) => h.toLowerCase()))];
}

export function estimateYears(content) {
  const now = new Date().getFullYear();
  const EDU = /(b\.?\s?e\b|b\.?\s?tech|m\.?\s?tech|mba|pgdm|pgpm|b\.?\s?a\b|b\.?\s?com|b\.?\s?sc|bba|university|college|institute|school|iit|iim|nit\b|cgpa|gpa|education)/i;
  let earliest = null;
  for (const line of content.split(/\n/)) {
    if (EDU.test(line)) continue;
    const re = /(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?((?:19|20)\d{2})\s*[–—-]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?((?:19|20)\d{2}|present|current|now|till date)/gi;
    let m;
    while ((m = re.exec(line))) {
      const y = Number(m[1]);
      if (y >= 1990 && y <= now && (earliest === null || y < earliest)) earliest = y;
    }
  }
  return earliest ? Math.max(0, now - earliest) : null;
}

function scoreFor(hits, strict) {
  const n = hits.length;
  let s = n === 0 ? 1 : n === 1 ? 2 : n <= 3 ? 3 : n <= 5 ? 4 : 5;
  if (strict && s > 1) s -= 1;
  return s;
}

export function demoScore(content, rubric) {
  const years = estimateYears(content);
  const build = (role) => {
    const strict = role === 'SPM';
    const criteria = rubric[role].map((c) => {
      const hits = evidence(content, c.position);
      let score = scoreFor(hits, strict && c.position !== 4);
      if (strict && c.position === 4) score = Math.max(1, Math.min(score, years !== null && years >= 5 ? 5 : 3));
      const reason = hits.length
        ? `Evidence of ${LABEL[c.position]}: “${hits.slice(0, 3).join('”, “')}”${hits.length > 3 ? ` +${hits.length - 3} more` : ''}.`
        : `No clear evidence of ${LABEL[c.position]} in the CV.`;
      return { name: c.name, weight: c.weight, score, reason };
    });
    const total = Math.round(criteria.reduce((s, c) => s + (c.weight * c.score) / 5, 0) * 10) / 10;
    return { total, criteria };
  };
  return { PM: build('PM'), SPM: build('SPM'), years, engine: 'demo' };
}

const ROLE_LABEL = { PM: 'Product Manager', SPM: 'Senior Product Manager' };

export function demoDraft(candidate, decision) {
  const role = candidate.applied_role;
  const s = candidate.scores[role];
  const sorted = [...s.criteria].sort((a, b) => b.score * b.weight - a.score * a.weight);
  const best = sorted[0], second = sorted[1], weakest = [...s.criteria].sort((a, b) => a.score - b.score)[0];
  const firstLine = (candidate.cv_content.split('\n').map((l) => l.trim()).find((l) => l.length > 25 && !/\[(NAME|EMAIL|PHONE)\]/.test(l)) || '').slice(0, 110);
  const yrs = candidate.scores.years ? `${candidate.scores.years}+ years of experience` : 'relevant experience';

  if (decision === 'invite') {
    return {
      brief: `Candidate with ${yrs}; profile opens with “${firstLine}”. Ranked high on ${best.name.toLowerCase()} (${best.score}/5) and ${second.name.toLowerCase()} (${second.score}/5). In the interview, probe ${weakest.name.toLowerCase()} (${weakest.score}/5) — ask for one specific example with outcome.`,
      subject: `Interview for ${ROLE_LABEL[role]} at Kargo`,
      body: `Hi [NAME],\n\nThank you for applying for the ${ROLE_LABEL[role]} role at Kargo. Your background stood out to us — particularly your ${best.name.toLowerCase()}, which maps closely to what has made people successful here.\n\nI'd like to invite you to a 45-minute conversation with me in Mumbai (or video, if easier). Could you reply with two or three time slots that work for you next week?\n\nLooking forward to it.\n\nArjun Mehta\nFounder, Kargo`,
    };
  }
  return {
    brief: null,
    subject: `Your application to Kargo — ${ROLE_LABEL[role]}`,
    body: `Hi [NAME],\n\nThank you for taking the time to apply for the ${ROLE_LABEL[role]} role at Kargo, and I'm sorry it has taken us a while to get back to you.\n\nWe appreciated seeing your ${best.name.toLowerCase()} in your application. After careful review, we won't be moving forward with your application for this role right now.\n\nI genuinely wish you the best in your search.\n\nArjun Mehta\nFounder, Kargo`,
  };
}
