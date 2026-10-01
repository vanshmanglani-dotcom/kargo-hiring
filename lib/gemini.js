// Every call here receives REDACTED content only. Personal details never reach the model.
// Uses the Gemini API directly when GEMINI_API_KEY is set; otherwise routes Gemini through
// Vercel AI Gateway, authenticated automatically with the deployment's OIDC token (no key needed).
import { getVercelOidcToken } from '@vercel/oidc';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJSON(text) {
  const t = (text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
}

async function viaGemini(prompt, schema, temperature) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  if (!res.ok) { const e = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`); e.status = res.status; throw e; }
  const data = await res.json();
  return parseJSON(data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join(''));
}

async function viaGateway(prompt, schema, temperature) {
  const token = process.env.AI_GATEWAY_API_KEY || (await getVercelOidcToken());
  const model = process.env.GATEWAY_MODEL || 'google/gemini-2.5-flash';
  const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Reply with ONLY a JSON object matching this schema (types in UPPERCASE are JSON types):\n${JSON.stringify(schema)}` },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) { const e = new Error(`AI Gateway ${res.status}: ${(await res.text()).slice(0, 300)}`); e.status = res.status; throw e; }
  const data = await res.json();
  return parseJSON(data?.choices?.[0]?.message?.content);
}

export async function geminiJSON(prompt, schema, { temperature = 0 } = {}) {
  const call = process.env.GEMINI_API_KEY ? viaGemini : viaGateway;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await call(prompt, schema, temperature); }
    catch (e) {
      lastErr = e;
      if (e.status && e.status !== 429 && e.status < 500) break;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}
