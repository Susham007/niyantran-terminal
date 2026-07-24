// Niyantran "Ask AI" gateway — FREE engine: Groq (primary) + Google Gemini (fallback).
//
// Contract (unchanged, so the terminal needs zero edits):
//   POST /api/askai  { system?, messages:[{role,content}], model?, max_tokens?, search? }
//     -> 200 { text }            on success
//     -> 4xx/5xx { error }       on failure
//
// Why two providers: Groq is the fastest free inference available but its free
// tier is rate-limited (requests/min + /day). When Groq is throttled or errors,
// we transparently fall back to Gemini Flash (very generous free daily limit).
// The caller never sees the switch — it just gets { text }.
//
// SECURITY: both keys come ONLY from environment variables. Nothing is baked in.
// Set GROQ_API_KEY and GEMINI_API_KEY in Netlify -> Site -> Environment variables
// (and in a local .env for `netlify dev`). See .env.example.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// Best-effort per-IP throttle. Serverless instances are ephemeral so this only
// dampens abuse per warm instance — real protection is a shared KV, noted in the
// README. Still stops a single tab from hammering the endpoint in a loop.
const HITS = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 20;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 500) { for (const k of HITS.keys()) { HITS.delete(k); if (HITS.size <= 500) break; } }
  return arr.length > MAX_PER_WINDOW;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json('', 204);
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const ip = (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
  if (rateLimited(ip)) return json({ error: 'Too many requests — slow down a moment.' }, 429);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages[] is required' }, 400);

  const system = typeof body.system === 'string' ? body.system : '';
  const maxTokens = Math.min(2048, Math.max(64, body.max_tokens || 500));

  // Normalise incoming Anthropic/OpenAI-style messages to plain {role, text}.
  const norm = messages
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      text: typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content) ? m.content.map(b => (b && b.text) || '').join('\n') : String(m.content || ''),
    }))
    .filter(m => m.text);
  if (!norm.length) return json({ error: 'messages[] had no text content' }, 400);

  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const gemKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!groqKey && !gemKey) return json({ error: 'AI is not configured (no GROQ_API_KEY or GEMINI_API_KEY set).' }, 503);

  const errors = [];

  // ---- 1) Groq (primary) ----
  if (groqKey) {
    try {
      const text = await askGroq(groqKey, system, norm, maxTokens);
      if (text) return json({ text, engine: 'groq' });
      errors.push('groq: empty');
    } catch (e) { errors.push('groq: ' + msg(e)); }
  }

  // ---- 2) Gemini (fallback) ----
  if (gemKey) {
    try {
      const text = await askGemini(gemKey, system, norm, maxTokens);
      if (text) return json({ text, engine: 'gemini' });
      errors.push('gemini: empty');
    } catch (e) { errors.push('gemini: ' + msg(e)); }
  }

  return json({ error: 'AI unavailable — ' + (errors.join(' | ') || 'both engines failed') }, 502);
};

async function askGroq(key, system, norm, maxTokens) {
  const oaMessages = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of norm) oaMessages.push({ role: m.role, content: m.text });

  const r = await fetchTimeout(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: GROQ_MODEL, messages: oaMessages, max_tokens: maxTokens, temperature: 0.5 }),
  }, 22000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Groq ' + r.status));
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}

async function askGemini(key, system, norm, maxTokens) {
  const contents = norm.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const payload = { contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5 } };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(key);
  const r = await fetchTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 22000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Gemini ' + r.status));
  const cand = data.candidates && data.candidates[0];
  return ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('').trim();
}

function fetchTimeout(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
}
function msg(e) { return String((e && e.message) || e).slice(0, 160); }
function json(obj, status) {
  const s = status || 200;
  return new Response(s === 204 ? null : (typeof obj === 'string' ? obj : JSON.stringify(obj)), {
    status: s,
    headers: {
      'Content-Type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
}
