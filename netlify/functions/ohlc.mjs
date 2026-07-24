// Niyantran — server-side historical OHLC proxy for the finance candlestick
// charts. Pulls REAL daily open/high/low/close from Yahoo Finance's public
// chart endpoint (no key) so the browser isn't CORS-blocked. Nothing is
// fabricated: if the upstream has no data for a symbol, we return an empty
// series and the UI says so.
//
//   GET /api/ohlc?symbol=^NSEI&range=6mo   ->  {symbol,currency,meta,t[],o[],h[],l[],c[],v[]}
//
// range: 1mo | 3mo | 6mo | 1y | 2y  (interval fixed at 1d)

const ALLOWED_RANGE = new Set(['1mo', '3mo', '6mo', '1y', '2y']);

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const symbol = (q.get('symbol') || '').trim();
  let range = (q.get('range') || '6mo').trim();
  if (!symbol || !/^[\^A-Za-z0-9.\-=&]+$/.test(symbol)) return json({ error: 'bad symbol' }, 400);
  if (!ALLOWED_RANGE.has(range)) range = '6mo';

  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr = 'unknown';
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (NiyantranTerminal)', 'Accept': 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) { lastErr = 'upstream ' + r.status; continue; }
      const data = await r.json();
      const res = data && data.chart && data.chart.result && data.chart.result[0];
      if (!res || !res.timestamp) { lastErr = 'no series'; continue; }
      const ts = res.timestamp;
      const qd = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      const o = qd.open || [], h = qd.high || [], l = qd.low || [], c = qd.close || [], v = qd.volume || [];
      const t = [], oo = [], hh = [], ll = [], cc = [], vv = [];
      for (let i = 0; i < ts.length; i++) {
        if (o[i] == null || h[i] == null || l[i] == null || c[i] == null) continue; // drop holidays/gaps
        t.push(ts[i]); oo.push(round(o[i])); hh.push(round(h[i])); ll.push(round(l[i])); cc.push(round(c[i])); vv.push(v[i] == null ? null : v[i]);
      }
      const meta = res.meta || {};
      return json({
        symbol,
        currency: meta.currency || 'INR',
        exchange: meta.exchangeName || '',
        meta: { regularMarketPrice: meta.regularMarketPrice, previousClose: meta.chartPreviousClose || meta.previousClose },
        t, o: oo, h: hh, l: ll, c: cc, v: vv,
      }, 200, 900);
    } catch (e) { lastErr = String((e && e.message) || e); }
  }
  return json({ error: 'no data', detail: lastErr, symbol, t: [], o: [], h: [], l: [], c: [], v: [] }, 200, 120);
};

function round(n) { return Math.round(n * 100) / 100; }
function json(obj, status, maxAge) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=' + (maxAge || 300),
    },
  });
}
