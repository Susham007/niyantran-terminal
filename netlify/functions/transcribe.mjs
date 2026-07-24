// Niyantran transcription proxy — server-side Groq Whisper (large-v3) gateway.
//
// The browser captures the LIVE TV tab's audio and POSTs ~6s webm/opus clips
// here; this function forwards each clip to Groq's OpenAI-compatible Whisper
// endpoint (excellent Hindi + English + Hinglish) and returns the text. The key
// stays server-side (never in the page); the browser needs no key and no
// install — just one click to share the tab's audio.
//
// Setup: the free Groq key is baked in below. To use your own / rotate for a
// real launch, set the Netlify env var GROQ_API_KEY (it wins over the default).
// Get a free key: https://console.groq.com/keys

const DEFAULT_KEY = ''; // removed — set the key ONLY as a Netlify env var
const DEFAULT_MODEL = 'whisper-large-v3'; // best Hindi; use 'whisper-large-v3-turbo' for lower latency

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = (process.env.GROQ_API_KEY || '').trim();
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const lang = (new URL(req.url).searchParams.get('lang') || '').toLowerCase();

  let buf;
  try { buf = await req.arrayBuffer(); } catch { return json({ error: 'no audio body' }, 400); }
  if (!buf || buf.byteLength < 1200) return json({ text: '' }); // silence / too short

  const ct = req.headers.get('content-type') || 'audio/webm';
  const ext = /ogg/.test(ct) ? 'ogg' : /mp4|m4a|aac/.test(ct) ? 'm4a' : /wav/.test(ct) ? 'wav' : 'webm';

  const form = new FormData();
  form.append('file', new Blob([buf], { type: ct }), 'clip.' + ext);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (lang === 'hi' || lang === 'en') form.append('language', lang);

  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (data.error && data.error.message) || ('Groq ' + r.status) }, r.status);
    return json({ text: (data.text || '').trim() });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
};

function cors() { return { 'Access-Control-Allow-Origin': '*' }; }
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json', ...cors() } }); }
