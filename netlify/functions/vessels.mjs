// Niyantran — Vessel positions proxy. Source: VesselAPI (vesselapi.com). Used as
// the fallback for aisstream (which is down). VesselAPI is a REST API, NOT CORS-
// open, and the key must stay server-side, so this same-origin Function proxies
// the bounding-box query and returns a compact vessel list WITH CORS.
//
//   GET /api/vessels?latTop=&latBottom=&lonLeft=&lonRight=
//
// HARD LIMITS (VesselAPI): free tier = 150 calls / MONTH (so the client fetches
// ONCE and never polls) and the bounding box total span (|dLat|+|dLon|) must be
// <= 4 degrees — this function clamps to <= 3.8 around the box centre.
//
// Key from env VESSELAPI_KEY (server-side only; hardcoded fallback so it works
// out-of-the-box — for a public repo, move it to a Netlify env var).

const KEY = process.env.VESSELAPI_KEY || '38cacf371c56208457ee9ea69e4241dfa4067cbd9cf846333d481cfd1509819e';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=120' } });

function clampBox(latTop, latBottom, lonLeft, lonRight) {
  const cLat = (latTop + latBottom) / 2, cLon = (lonLeft + lonRight) / 2;
  let dLat = Math.abs(latTop - latBottom), dLon = Math.abs(lonRight - lonLeft);
  const span = dLat + dLon;
  if (span > 3.8) { const k = 3.8 / span; dLat *= k; dLon *= k; }
  return { latTop: cLat + dLat / 2, latBottom: cLat - dLat / 2, lonLeft: cLon - dLon / 2, lonRight: cLon + dLon / 2 };
}

export default async (req) => {
  const p = new URL(req.url).searchParams, n = k => parseFloat(p.get(k));
  try {
    const b = clampBox(n('latTop'), n('latBottom'), n('lonLeft'), n('lonRight'));
    const u = 'https://api.vesselapi.com/v1/location/vessels/bounding-box'
      + '?filter.latTop=' + b.latTop.toFixed(4) + '&filter.latBottom=' + b.latBottom.toFixed(4)
      + '&filter.lonLeft=' + b.lonLeft.toFixed(4) + '&filter.lonRight=' + b.lonRight.toFixed(4);
    const r = await fetch(u, { headers: { 'Authorization': 'Bearer ' + KEY, 'Accept': 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return json({ error: (j.error && j.error.message) || ('vesselapi ' + r.status), quota: r.status === 429 }, 502);
    const vessels = (j.vessels || []).map(v => ({
      mmsi: v.mmsi, name: (v.vessel_name || '').trim(), lat: v.latitude, lon: v.longitude,
      sog: v.sog, cog: v.cog, hdg: v.heading, nav: v.nav_status, imo: v.imo || null
    })).filter(v => v.lat != null && v.lon != null);
    return json({ vessels, count: vessels.length, box: b });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 502); }
};
