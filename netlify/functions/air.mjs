// Niyantran — Air Traffic proxy with a source CHAIN so it still works when one
// upstream is blocked on the caller's network:
//   1) OpenSky Network (OAuth2 client-credentials, global, bbox)
//   2) adsb.fi   (free community ADS-B, no key, radius query)
//   3) adsb.lol  (free community ADS-B, no key, radius query)
// None of these are CORS-open, so this same-origin Function proxies them and
// returns a compact airborne list WITH CORS. Nothing stored.
//
//   GET /api/air?lamin=&lamax=&lomin=&lomax=   -> { aircraft:[...], count, source }
//
// Credentials from env (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET); hardcoded
// fallback so it works out of the box. SERVER-SIDE ONLY (never sent to browsers).
// For a public repo, set the env vars and delete the fallback.

const CLIENT_ID = process.env.OPENSKY_CLIENT_ID || 'susham100syc@gmail.com-api-client';
const CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET || 'PRGrnu5q9KCxn4X3acoUDi5cYap1aOby';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let _tok = null, _tokExp = 0;
async function getToken() {
  if (_tok && Date.now() < _tokExp - 60000) return _tok;
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }), signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  _tok = j.access_token; _tokExp = Date.now() + (j.expires_in || 1800) * 1000;
  return _tok;
}
function catOf(c) { c = +c || 0; if (c >= 4 && c <= 6) return 'airliner'; if (c === 7) return 'jet'; if (c === 8) return 'heli'; if (c === 2 || c === 3) return 'light'; if (c === 9) return 'glider'; if (c === 10) return 'lta'; if (c >= 14 && c <= 15) return 'uav'; return 'other'; }
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=8' } });

async function fromOpenSky(bx) {
  const tok = await getToken();
  let u = 'https://opensky-network.org/api/states/all';
  if (bx) u += `?lamin=${bx.lamin}&lamax=${bx.lamax}&lomin=${bx.lomin}&lomax=${bx.lomax}`;
  const r = await fetch(u, { headers: { 'Authorization': 'Bearer ' + tok }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('opensky ' + r.status);
  const d = await r.json();
  return (d.states || []).filter(s => s[5] != null && s[6] != null && !s[8]).map(s => ({
    icao: s[0], flt: (s[1] || '').trim(), country: s[2], lon: s[5], lat: s[6],
    alt: s[7] != null ? Math.round(s[7]) : (s[13] != null ? Math.round(s[13]) : null),
    vel: s[9] != null ? Math.round(s[9]) : null, hdg: s[10] != null ? Math.round(s[10]) : null,
    vrate: s[11] != null ? Math.round(s[11] * 10) / 10 : null, cat: catOf(s[17])
  }));
}
// Community ADS-B feeds are RADIUS-based (nautical miles, hard cap 250 = ~4.16 deg),
// so a wide region needs several overlapping circles TILED across the bbox, merged
// and de-duplicated by ICAO hex. Capped at 9 circles to stay polite to a free service.
function tileCenters(bx, stepDeg, max) {
  const pts = [];
  const nLat = Math.max(1, Math.ceil((bx.lamax - bx.lamin) / stepDeg));
  const nLon = Math.max(1, Math.ceil((bx.lomax - bx.lomin) / stepDeg));
  const sLat = (bx.lamax - bx.lamin) / nLat, sLon = (bx.lomax - bx.lomin) / nLon;
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++)
    pts.push([bx.lamin + sLat * (i + .5), bx.lomin + sLon * (j + .5)]);
  if (pts.length <= max) return pts;
  const stride = pts.length / max, out = [];
  for (let k = 0; k < max; k++) out.push(pts[Math.floor(k * stride)]);
  return out;
}
function mapAdsb(a) {
  return {
    icao: a.hex, flt: (a.flight || '').trim(), country: '', lon: a.lon, lat: a.lat,
    alt: (typeof a.alt_baro === 'number') ? Math.round(a.alt_baro * 0.3048) : null,   // ft -> m
    vel: (typeof a.gs === 'number') ? Math.round(a.gs * 0.5144) : null,               // kn -> m/s
    hdg: (typeof a.track === 'number') ? Math.round(a.track) : null,
    vrate: (typeof a.baro_rate === 'number') ? Math.round(a.baro_rate * 0.00508 * 10) / 10 : null,
    reg: a.r || null, actype: a.t || null, desc: a.desc || null, cat: 'other'
  };
}
// These are free community feeds and they rate-limit HARD: a parallel burst of 9
// returns 429s and briefly blocks the caller. So: at most 3 circles, SEQUENTIAL,
// spaced out, and we stop at the first 429 and keep whatever we already have.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOSTS = ['https://api.adsb.lol', 'https://opendata.adsb.fi/api'];  // adsb.lol first: adsb.fi often answers empty

async function circle(host, la, lo, ms, nm) {
  const u = host + '/v2/lat/' + la.toFixed(3) + '/lon/' + lo.toFixed(3) + '/dist/' + (nm || 250);
  const r = await fetch(u, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('adsb ' + r.status + (r.status === 429 ? ' (rate limited)' : ''));
  return (await r.json()).ac || [];
}
// RACE both hosts on the centre circle (whichever answers first wins) instead of
// trying them in series -- serial fallback took 7.3s, too close to the 10s function
// timeout. Then add ONE more circle from the winning host for wider coverage, but
// only if we still have time budget. Free feeds 429 on bursts, so never parallel-tile.
// Busy-airspace ANCHORS. A radius feed must be aimed at traffic, not at geometry:
// the centre of the World bbox is (2N, 0E) -- the Gulf of Guinea -- which is why a
// world view returned "reachable but 0 aircraft". We pick anchors that fall inside
// the requested bbox instead, so both a world view and a regional view aim at planes.
const ANCHORS = [
  ['Europe', 50.0, 8.5, 120], ['UK', 51.5, -0.5, 120], ['USA-East', 40.0, -75.0, 140],
  ['USA-West', 34.0, -118.0, 160], ['USA-Mid', 41.9, -87.9, 160], ['Gulf', 25.3, 55.4],
  ['India-N', 26.5, 77.5], ['India-S', 13.0, 78.0], ['SE-Asia', 3.5, 103.5],
  ['E-Asia', 34.5, 135.0], ['China', 31.2, 121.5], ['Brazil', -23.5, -46.6],
  ['Africa-S', -26.1, 28.2], ['Australia', -33.9, 151.2],
];
// `rot` rotates through the eligible anchors so successive polls sweep DIFFERENT
// airspaces — the client merges polls with an expiry, so a world view accumulates
// real global coverage in a few polls instead of showing the same 3 clusters forever.
function pickAnchors(bx, max, rot) {
  const inside = ANCHORS.filter(([, la, lo]) =>
    la >= bx.lamin && la <= bx.lamax && lo >= bx.lomin && lo <= bx.lomax);
  if (!inside.length) return [['centre', (bx.lamin + bx.lamax) / 2, (bx.lomin + bx.lomax) / 2]];
  if (inside.length <= max) return inside;
  const off = ((rot || 0) * max) % inside.length;
  const out = [];
  for (let k = 0; k < max; k++) out.push(inside[(off + k) % inside.length]);
  return out;
}
// adsb.lol 429s after ~4 rapid calls and adsb.fi frequently answers with an EMPTY
// array (that empty answer is what made an earlier Promise.any race report zero
// aircraft). So: adsb.lol is primary, adsb.fi is only a per-anchor fallback, calls
// are SEQUENTIAL with a gap, and the whole sweep is bounded by a wall-clock deadline.
async function fromAdsbAny(bx, rot) {
  const t0 = Date.now(), DEADLINE = 6200;
  const anchors = pickAnchors(bx, 3, rot);   // 3 is the most adsb.lol tolerates before 429
  const seen = new Map();
  const errs = [];
  let served = 0;
  const take = (list) => { for (const a of list || []) {
    if (a.lat == null || a.lon == null || a.gnd || a.alt_baro === 'ground') continue;
    if (a.lat < bx.lamin - 1 || a.lat > bx.lamax + 1 || a.lon < bx.lomin - 1 || a.lon > bx.lomax + 1) continue;
    if (!seen.has(a.hex)) seen.set(a.hex, mapAdsb(a));
  } };

  for (let i = 0; i < anchors.length; i++) {
    if (Date.now() - t0 > DEADLINE) break;
    const [, la, lo, nm] = anchors[i];
    if (i) await sleep(320);
    let got = false;
    for (const h of HOSTS) {                         // adsb.lol first, adsb.fi as backup
      // 4200ms per circle: Europe-sized payloads cannot download in 2.8s
      try { const ac = await circle(h, la, lo, 4200, nm); if (ac.length) { take(ac); got = true; served++; break; } }
      catch (e) { errs.push(anchors[i][0] + ' ' + label2(h) + ': ' + e.message); }
      if (Date.now() - t0 > DEADLINE - 2500) break;
    }
    if (!got && !errs.length) errs.push(anchors[i][0] + ': empty');
  }
  if (!served && !seen.size) throw new Error(errs.slice(0, 3).join(' / ') || 'adsb returned nothing');
  return { list: [...seen.values()], host: 'adsb', anchors: anchors.map(a => a[0]).join(',') };
}
const label2 = h => h.replace(/https:\/\/(opendata\.)?/, '').replace('/api', '');

export default async (req) => {
  const p = new URL(req.url).searchParams, q = k => p.get(k);
  const bx = q('lamin') ? { lamin: +q('lamin'), lamax: +q('lamax'), lomin: +q('lomin'), lomax: +q('lomax') } : null;
  const rot = parseInt(q('rot') || '0', 10) || 0;
  const tried = [];
  const box = bx || { lamin: 6, lamax: 36, lomin: 68, lomax: 98 };

  // Sources run in PARALLEL, not in series. Serial cost is opensky-timeout PLUS the
  // ADS-B sweep, which blew past the function limit and surfaced as a bare 502 in the
  // browser; in parallel the cost is the SLOWER of the two. OpenSky is still preferred
  // (one call, full bbox, ~200+ aircraft) — ADS-B only starts if OpenSky hasn't
  // answered within a short grace period, so a healthy OpenSky never spends the
  // community feeds' tight rate-limit budget.
  // NOTE: the gate must be "OpenSky SUCCEEDED", not "OpenSky finished". A failure also
  // finishes, and gating on completion made a fast OpenSky failure skip the fallback
  // entirely -> 502 with zero aircraft even though ADS-B was available.
  let skyWon = false;
  const skyP = fromOpenSky(bx)
    .then(ac => { skyWon = !!(ac && ac.length); return ac; })
    .catch(e => { tried.push('opensky: ' + String((e && e.message) || e)); return null; });

  const adsbP = sleep(1200).then(() => {
    if (skyWon) return null;                         // OpenSky already delivered
    return fromAdsbAny(box, rot).catch(e => {
      tried.push('adsb: ' + String((e && e.message) || e));
      return null;
    });
  });

  // A world query returns ~6000 aircraft (>1MB). That is a heavy payload to ship and
  // thousands of rotated triangles to redraw every frame, so thin it evenly — the map
  // reads the same and the canvas stays smooth.
  const CAP = 2200;
  const thin = (arr) => {
    if (arr.length <= CAP) return arr;
    const step = arr.length / CAP, out = [];
    for (let i = 0; i < CAP; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  };

  const sky = await skyP;
  if (sky && sky.length) {
    const list = thin(sky);
    return json({ aircraft: list, count: list.length, total: sky.length, source: 'opensky' });
  }
  if (sky && !sky.length) tried.push('opensky: 0 aircraft');

  const adsb = await adsbP;
  if (adsb && adsb.list.length) return json({ aircraft: adsb.list, count: adsb.list.length, source: 'adsb.lol', anchors: adsb.anchors });
  if (adsb) tried.push('adsb: 0 aircraft in view');

  return json({ aircraft: [], count: 0, error: 'all air sources failed — ' + tried.join(' | ') }, 502);
};
