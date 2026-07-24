// Niyantran "Manthan" proxy — server-side NVIDIA Nemotron (NIM) gateway.
//
// Why this exists: NVIDIA's integrate.api.nvidia.com does NOT send CORS
// headers, so a browser (the terminal on Netlify) can't call it directly;
// and putting the key in the client HTML would expose it publicly. This
// serverless Function holds the key as a PRIVATE env var and is same-origin
// to the site, so the browser calls /.netlify/functions/manthan with no CORS
// and the key never reaches the client.
//
// Setup (once):
//   Netlify → Site settings → Environment variables:
//     NVIDIA_API_KEY = nvapi-...            (REQUIRED — a key with inference credits)
//     NVIDIA_MODEL   = meta/llama-3.1-8b-instruct   (optional; default below)
//
// Get a key: https://build.nvidia.com → sign in → open any model → "Get API Key".

const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct'; // fastest reliable default; override via NVIDIA_MODEL
// Baked-in default so the prototype works with ZERO setup (no env var needed).
// Runs server-side only — it is never sent to the browser. For a real launch,
// override it with a Netlify env var (NVIDIA_API_KEY) and rotate this one.
const DEFAULT_KEY = ''; // removed — set the key ONLY as a Netlify env var

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204 });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = (process.env.NVIDIA_API_KEY || '').trim();

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages[] is required' }, 400);
  const model = body.model || process.env.NVIDIA_MODEL || DEFAULT_MODEL;

  try {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: body.max_tokens || 700,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
        stream: false,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: data && (data.detail || data.title) || ('NVIDIA ' + r.status), status: r.status }, r.status);
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return json({ text, model });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
