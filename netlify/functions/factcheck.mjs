// Niyantran fact-check proxy — server-side Google Fact Check Tools API.
//
// Why: keeps the (free) Google API key OFF the client. The browser calls the
// same-origin /.netlify/functions/factcheck instead of Google directly, so the
// key never ships in the page. Without a key the feed is simply empty and the
// panel's "Check a claim" box falls back to the NVIDIA assessment — nothing
// breaks.
//
// Setup (once, free, ~2 min):
//   1. https://console.cloud.google.com  → create/pick a project
//   2. APIs & Services → Library → enable "Fact Check Tools API"
//   3. APIs & Services → Credentials → Create credentials → API key
//   4. Netlify → Site settings → Environment variables:
//        GOOGLE_FACTCHECK_KEY = <that key>
//   (or paste it into DEFAULT_KEY below for a zero-env prototype)

// Baked-in default so the feed works with ZERO env setup. Free Google Fact
// Check Tools key — server-side only, never sent to the browser. For a real
// launch, override with the Netlify env var GOOGLE_FACTCHECK_KEY and rotate this.
const DEFAULT_KEY = ''; // removed — set the key ONLY as a Netlify env var

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204 });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = (process.env.GOOGLE_FACTCHECK_KEY || '').trim();
  if (!key) return json({ error: 'no-key' }, 200); // deployed but unconfigured — client falls back

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const query = (body.query || '').toString().slice(0, 300).trim();
  if (!query) return json({ error: 'query is required' }, 400);
  const lang = (body.languageCode || 'en').toString().slice(0, 5);
  const pageSize = Math.min(Number(body.pageSize) || 10, 20);

  const url = 'https://factchecktools.googleapis.com/v1alpha1/claims:search'
    + '?query=' + encodeURIComponent(query)
    + '&languageCode=' + encodeURIComponent(lang)
    + '&pageSize=' + encodeURIComponent(String(pageSize))
    + '&key=' + encodeURIComponent(key);

  try {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (data && data.error && data.error.message) || ('Google ' + r.status) }, r.status);
    return json({ claims: Array.isArray(data.claims) ? data.claims : [] });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
