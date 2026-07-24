// Niyantran — live conflict wire. Replaces the old hand-compiled 10-row war
// tracker with a real feed from GDELT 2.0 (free, no API key, global, updated
// continuously). Nothing is stored: this is a thin proxy + normaliser.
//
//   GET /api/conflict                 -> { rows:[...], meta:{...} }
//   GET /api/conflict?topic=ukraine   -> narrowed query
//   GET /api/conflict?days=7          -> wider window (default 3)
//
// Two things this function must do that a raw GDELT call does not:
//   1. DEDUPE. 34% of raw results are wire syndication — one story appeared
//      from 25 different local papers. We collapse by normalised headline and
//      keep the outlet count, which is itself a useful signal of how big a
//      story is.
//   2. TAG a region so the feed is filterable by theatre.
//
// GDELT asks for no more than one request every 5s, so the response is cached
// at the edge for 20 minutes — all users share one upstream pull.
import https from 'node:https';

const UA = 'Mozilla/5.0 (NiyantranTerminal; conflict wire)';

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new Error('too many redirects'));
    const req = https.request(url, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/json,*/*' }, timeout: 20000 }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) { res.destroy(); return resolve(get(new URL(loc, url).href, redirects + 1)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 8e6) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const REGIONS = [
  ['Ukraine / Russia', /ukrain|kyiv|kharkiv|donetsk|russia|moscow|kremlin|zaporizh/i],
  ['Middle East', /gaza|israel|hamas|hezbollah|lebanon|iran|tehran|houthi|yemen|syria|iraq|west bank|idf/i],
  ['Sudan / Horn', /sudan|khartoum|darfur|ethiopia|somalia|eritrea|tigray/i],
  ['Sahel / West Africa', /mali|niger|burkina|chad|sahel|nigeria|boko haram|cameroon/i],
  ['South Asia', /pakistan|afghan|taliban|kashmir|myanmar|burma|bangladesh|sri lanka/i],
  ['East Asia', /taiwan|korea|pyongyang|china|beijing|philippine|south china sea/i],
  ['Americas', /haiti|mexico|colombia|venezuela|ecuador|cartel/i],
  ['Europe', /serbia|kosovo|bosnia|armenia|azerbaijan|georgia|moldova|belarus/i],
  ['Africa (other)', /congo|drc|rwanda|mozambique|libya|m23|sahel/i],
];
function regionOf(t) { for (const [name, re] of REGIONS) if (re.test(t)) return name; return 'Other'; }

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function fmtTime(s) { // 20260720T113000Z -> 2026-07-20 11:30
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s || '');
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : (s || '');
}

const BASE = '(ceasefire OR airstrike OR "armed conflict" OR insurgency OR shelling OR militants OR offensive OR "peace talks")';

// Warm-instance fallback: the edge cache (20 min) is the primary shield, but a
// throttled GDELT should never blank the wire — serve the last good pull instead.
const WARM = new Map(); // key -> { body, at }
const WARM_TTL = 30 * 60 * 1000;
function warmGet(key) {
  const w = WARM.get(key);
  return (w && Date.now() - w.at < WARM_TTL) ? w.body : null;
}
function warmPut(key, body) {
  WARM.set(key, { body, at: Date.now() });
  if (WARM.size > 8) WARM.delete(WARM.keys().next().value);
}

export default async (req) => {
  const p = new URL(req.url).searchParams;
  const topic = (p.get('topic') || '').trim().slice(0, 60);
  const days = Math.min(14, Math.max(1, parseInt(p.get('days') || '3', 10) || 3));
  const warmKey = topic + '|' + days;
  const q = (topic ? `"${topic.replace(/"/g, '')}" ${BASE}` : BASE) + ' sourcelang:english';

  const url = 'https://api.gdeltproject.org/api/v2/doc/doc'
    + '?query=' + encodeURIComponent(q)
    + '&mode=artlist&maxrecords=250&timespan=' + days + 'd&sort=datedesc&format=json';

  try {
    const r = await get(url);
    if (r.status === 429) {
      const warm = warmGet(warmKey);
      if (warm) return json({ ...warm, stale: true });
      return json({ error: 'GDELT rate limit — try again in a few seconds', rows: [] }, 429);
    }
    if (r.status !== 200) {
      const warm = warmGet(warmKey);
      if (warm) return json({ ...warm, stale: true });
      return json({ error: 'GDELT ' + r.status, rows: [] }, 502);
    }

    let data;
    try { data = JSON.parse(r.body); }
    catch (e) {
      const warm = warmGet(warmKey);
      if (warm) return json({ ...warm, stale: true });
      return json({ error: 'GDELT returned non-JSON (usually a rate-limit notice)', rows: [] }, 502);
    }

    const arts = data.articles || [];
    // collapse syndicated duplicates, keeping the outlet count as a signal
    const groups = new Map();
    for (const a of arts) {
      const k = norm(a.title).slice(0, 64);
      if (!k) continue;
      const g = groups.get(k);
      if (g) { g.outlets++; if ((a.seendate || '') > (g.seendate || '')) { g.seendate = a.seendate; } }
      else groups.set(k, { title: (a.title || '').replace(/\s+/g, ' ').trim(), seendate: a.seendate, domain: a.domain, url: a.url, country: a.sourcecountry, outlets: 1, tagText: (a.title || '') + ' ' + (a.url || '') });
    }
    const rows = [...groups.values()]
      .sort((a, b) => (b.seendate || '').localeCompare(a.seendate || ''))
      .map((x, i) => ({
        id: String(i + 1),
        time: fmtTime(x.seendate),
        region: regionOf(x.tagText || x.title),
        source: x.domain || '',
        title: x.title,
        outlets: x.outlets > 1 ? String(x.outlets) : '1',
        country: x.country || '',
        link: x.url || ''
      }));

    const payload = {
      rows,
      meta: {
        fetched: new Date().toISOString(),
        raw: arts.length, unique: rows.length, deduped: arts.length - rows.length,
        window: days + 'd', topic: topic || null,
        source: 'GDELT 2.0 DOC API (free, no key)'
      }
    };
    if (rows.length) warmPut(warmKey, payload);
    return json(payload);
  } catch (e) {
    const warm = warmGet(warmKey);
    if (warm) return json({ ...warm, stale: true });
    return json({ error: 'fetch failed: ' + (e && e.message), rows: [] }, 502);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      // one upstream pull shared by everyone — respects GDELT's 1-per-5s ask
      'cache-control': status === 200 ? 'public, max-age=1200, s-maxage=1200' : 'no-store'
    }
  });
}
