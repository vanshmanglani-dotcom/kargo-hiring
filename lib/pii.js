// Separates personal details from CV content BEFORE anything reaches an AI model.
// Deterministic (regex + heuristics), so personal data never leaves our server/DB.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)\d{3,5}[\s.-]?\d{3,5}/g;
const PROFILE_URL = /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|leetcode\.com|twitter\.com|x\.com|gitlab\.com|behance\.net|medium\.com)\/[^\s|·,;]*/gi;
const SECTION_WORDS = /\b(summary|profile|experience|education|skills|objective|resume|curriculum|vitae|cv|contact|product|manager|engineer|senior|lead|certifications?|about)\b/i;

function titleCase(s) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameFromFilename(filename = '') {
  // e.g. "PDF05_ishaan_roy.pdf", "PDFpm_03_deepika_nair.pdf", "cv_07_lavanya_iyer.docx"
  const base = filename.replace(/\.[^.]+$/, '');
  const words = base.split(/[_\-\s]+/).filter((w) => /^[a-z]+$/i.test(w) && !/^(pdf|pdfpm|pdfspm|pm|spm|cv|resume|final|updated)$/i.test(w));
  return words.length >= 2 ? titleCase(words.slice(-2).join(' ')) : null;
}

function nameFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    const candidate = line.split(/[|·•,]/)[0].trim();
    if (EMAIL.test(candidate)) { EMAIL.lastIndex = 0; continue; }
    EMAIL.lastIndex = 0;
    const words = candidate.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w)) && !SECTION_WORDS.test(candidate)) {
      return titleCase(candidate);
    }
  }
  return null;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function splitPII(rawText, filename, nameOverride) {
  const text = rawText.replace(/ /g, ' ');
  const emails = text.match(EMAIL) || [];
  const phones = (text.match(PHONE) || []).filter((p) => p.replace(/\D/g, '').length >= 10);
  const name = (nameOverride && nameOverride.trim()) || nameFromText(text) || nameFromFilename(filename) || 'Candidate';

  let content = text
    .replace(EMAIL, '[EMAIL]')
    .replace(PROFILE_URL, '[PROFILE LINK]');
  for (const p of phones) content = content.split(p).join('[PHONE]');

  if (name !== 'Candidate') {
    content = content.replace(new RegExp(escapeRe(name), 'gi'), '[NAME]');
    for (const part of name.split(/\s+/)) {
      if (part.length >= 3) content = content.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'gi'), '[NAME]');
    }
  }
  content = content.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    pii: { name, email: emails[0] || null, phone: phones[0]?.trim() || null },
    content,
  };
}
