// Niyantran live-stream resolver — returns a channel's CURRENT live video id.
//
// Why: hardcoded YouTube video IDs go stale. A 24/7 news channel gets a NEW
// video id every time its stream restarts, so an old id falls back to an
// ancient recording. This function reads the channel's own /live page
// server-side (no API key, no quota) and extracts the current live video id
// from the canonical link. The browser can't do this itself — YouTube pages
// block cross-origin reads and we must follow the /live redirect.
//
// Input (POST JSON): { channelId?: "UC...", handle?: "aajtak" }
// Output: { videoId: "...", live: true|false }  or  { error: "..." }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204 });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const handle = (body.handle || '').toString().replace(/^@/, '').replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 60);
  const channelId = (body.channelId || '').toString().replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 40);
  const url = handle ? ('https://www.youtube.com/@' + handle + '/live')
    : channelId ? ('https://www.youtube.com/channel/' + channelId + '/live')
    : null;
  if (!url) return json({ error: 'handle or channelId required' }, 400);

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'CONSENT=YES+1' },
      redirect: 'follow',
    });
    const html = await r.text();
    const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)
      || html.match(/"canonicalBaseUrl":"\/watch\?v=([\w-]{11})"/)
      || html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)
      || html.match(/\\?"videoId\\?":\\?"([\w-]{11})\\?"/);
    const videoId = m ? m[1] : null;
    const live = /"isLiveNow":true|"isLive":true|hlsManifestUrl/.test(html);
    if (!videoId) return json({ error: 'no live video found', live: false }, 200);
    return json({ videoId, live });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}
