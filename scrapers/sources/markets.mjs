// AGENT: Markets — daily OHLC snapshots for the headline instruments (Yahoo
// public chart endpoint, no key). Powers the Home "Key Moves" rail + strip.
// NOTE: this is end-of-day / delayed data, appropriate for a 6h batch. Intraday
// tick data would need a licensed feed (see README).
import { get } from '../lib/http.mjs';

export const id = 'markets';
export const label = 'Markets (OHLC)';

const SYMS = [
  ['NIFTY 50', '^NSEI'], ['SENSEX', '^BSESN'], ['USD/INR', 'INR=X'], ['BRENT', 'BZ=F'],
  ['GOLD', 'GC=F'], ['NIFTY BANK', '^NSEBANK'], ['S&P 500', '^GSPC'], ['BITCOIN', 'BTC-USD'],
];
const round = n => (n == null ? null : Math.round(n * 100) / 100);

async function one(name, symbol) {
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includePrePost=false`;
      const r = await get(url, { json: true, timeout: 15000 });
      const res = r.body && r.body.chart && r.body.chart.result && r.body.chart.result[0];
      const c = (res && res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      const closes = c.filter(x => x != null).map(round);
      if (closes.length < 2) continue;
      const last = closes[closes.length - 1], prev = closes[closes.length - 2], first = closes[0];
      return { name, symbol, last, d1: round((last - prev) / prev * 100), dM: round((last - first) / first * 100), spark: closes };
    } catch { /* try next host */ }
  }
  return { name, symbol, error: 'no data' };
}

export async function run() {
  const rows = await Promise.all(SYMS.map(([n, s]) => one(n, s)));
  return { rows, source: 'Yahoo Finance chart API (delayed, fair-use)' };
}
