// Backend dashboard API. One function, three token-gated actions:
//   GET  /api/admin?action=health            -> agent manifest + env/AI config health
//   POST /api/admin  {action:'trigger',feed} -> fire the GitHub Actions agents workflow
//   POST /api/admin  {action:'aiping'}        -> live check that Groq/Gemini answer
//
// Auth: every call must send header  x-admin-token: <ADMIN_TOKEN>.  The token
// lives ONLY in the Netlify env var ADMIN_TOKEN — never in the page. If it is
// unset the admin surface is locked (503), so an unconfigured deploy is closed
// by default, not open.
import { readManifest } from '../../scrapers/lib/snapshot.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return json('', 204);

  const adminToken = (process.env.ADMIN_TOKEN || '').trim();
  if (!adminToken) return json({ error: 'Admin not configured — set ADMIN_TOKEN in Netlify env.' }, 503);

  const sent = (req.headers.get('x-admin-token') || '').trim();
  if (!sent || sent !== adminToken) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  let action = url.searchParams.get('action') || '';
  let bodyFeed = '';
  if (req.method === 'POST') {
    try { const b = await req.json(); action = b.action || action; bodyFeed = b.feed || ''; } catch { /* ignore */ }
  }

  if (action === 'health') return health();
  if (action === 'trigger') return trigger(bodyFeed);
  if (action === 'aiping') return aiPing();
  return json({ error: 'Unknown action' }, 400);
};

async function health() {
  // In production the bundled function can't read the repo's data/ dir, but the
  // manifest is a published static asset — fetch it over HTTP, fall back to the
  // filesystem for local `netlify dev` / devserver.
  let manifest = null;
  const origin = (process.env.URL || process.env.DEPLOY_URL || '').trim();
  if (origin) {
    try {
      const r = await fetch(origin + '/data/_manifest.json', { headers: { 'cache-control': 'no-cache' } });
      if (r.ok) manifest = await r.json();
    } catch { /* fall through to fs */ }
  }
  if (!manifest) manifest = await readManifest();
  // Report only PRESENCE of secrets, never their values.
  const env = {
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    ADMIN_TOKEN: true,
    GITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
    GITHUB_REPO: process.env.GITHUB_REPO || null,
    DATA_GOV_KEY: !!process.env.DATA_GOV_KEY,
  };
  return json({
    manifest,
    env,
    ai: {
      primary: 'groq:' + (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'),
      fallback: 'gemini:' + (process.env.GEMINI_MODEL || 'gemini-2.0-flash'),
      configured: env.GROQ_API_KEY || env.GEMINI_API_KEY,
    },
    schedule: 'every 6h (cron 0 */6 * * *) via GitHub Actions',
    now: new Date().toISOString(),
  });
}

async function trigger(feed) {
  const token = (process.env.GITHUB_TOKEN || '').trim();
  const repo = (process.env.GITHUB_REPO || '').trim(); // "owner/repo"
  if (!token || !repo) return json({ error: 'Manual trigger needs GITHUB_TOKEN + GITHUB_REPO env vars (fine-grained token with Actions: write).' }, 503);

  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/agents.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'niyantran-admin' },
    body: JSON.stringify({ ref: 'main', inputs: { feed: feed || '' } }),
  });
  if (r.status === 204) return json({ ok: true, message: 'Agents dispatched' + (feed ? ' for ' + feed : ' (all feeds)') + '. Check the Actions tab.' });
  const t = await r.text().catch(() => '');
  return json({ error: 'GitHub dispatch failed (' + r.status + '): ' + t.slice(0, 200) }, 502);
}

async function aiPing() {
  const origin = process.env.URL || '';
  // Call our own AI gateway with a trivial prompt to prove an engine responds.
  try {
    const r = await fetch((origin || 'http://localhost:8888') + '/api/askai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 8 }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.text) return json({ ok: true, engine: d.engine || '?', sample: d.text.slice(0, 40) });
    return json({ ok: false, error: d.error || ('status ' + r.status) });
  } catch (e) { return json({ ok: false, error: String(e.message || e) }); }
}

function json(obj, status) {
  const s = status || 200;
  return new Response(s === 204 ? null : (typeof obj === 'string' ? obj : JSON.stringify(obj)), {
    status: s,
    headers: {
      'Content-Type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, x-admin-token',
    },
  });
}
