// Niyantran — server-side PDF/byte proxy so the AI can READ an attached card's
// source PDF. Government PDF hosts (SC Registry, RBI, MHA/AGMUT) routinely block
// cross-origin browser fetches; this same-origin Function pulls the bytes and
// hands them back to the page, which extracts the text with pdf.js.
//
//   GET /api/fetchpdf?url=<pdfUrl>   ->  raw application/pdf bytes
//
// Capped size + timeout so a hostile/huge link can't wedge the function.
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB is plenty for an order/notice PDF

export default async (req) => {
  const u = new URL(req.url).searchParams.get('url') || '';
  if (!/^https?:\/\//i.test(u)) return new Response('bad url', { status: 400 });
  try {
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (NiyantranTerminal; +analyst PDF reader)',
        'Accept': 'application/pdf,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return new Response('upstream ' + r.status, { status: 502 });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return new Response('too large', { status: 413 });
    const ct = r.headers.get('content-type') || 'application/pdf';
    return new Response(buf, {
      status: 200,
      headers: {
        'content-type': ct,
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return new Response('fetch failed: ' + (e && e.message), { status: 502 });
  }
};
