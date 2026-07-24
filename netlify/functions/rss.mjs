// Media Suite · Pull News proxy — fetches an RSS/Atom feed server-side so the
// browser isn't blocked by CORS. No key required. GET /api/rss?url=<feedUrl>
export default async (req) => {
  const u = new URL(req.url).searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(u)) return new Response('bad url', { status: 400 });
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (NiyantranMediaSuite)' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    const text = await r.text();
    return new Response(text.slice(0, 800000), {
      status: r.ok ? 200 : r.status,
      headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  } catch (e) {
    return new Response('fetch failed: ' + (e && e.message), { status: 502 });
  }
};
