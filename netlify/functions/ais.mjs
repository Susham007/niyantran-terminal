// Niyantran — aisstream.io bridge. The browser cannot hold this WebSocket (it is
// blocked / fails the handshake in many networks), so this Function opens the
// aisstream socket SERVER-SIDE, subscribes, collects a few seconds of live
// PositionReports and returns them as a normal JSON snapshot with CORS.
// This is a different network path (Node TCP) than the browser WebSocket.
//
//   GET /api/ais?latMin=&latMax=&lonMin=&lonMax=   -> { vessels:[...], count, source }
//
// Key from env AISSTREAM_KEY (server-side only; hardcoded fallback so it works
// out of the box — move to a Netlify env var for a public repo).

const KEY = process.env.AISSTREAM_KEY || 'f2ddfadc7615d48e3ed808c90e4f5ae5ed9ee7cf';
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });

const NAVS = { 0: 'Under way (engine)', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Fishing', 8: 'Under way (sailing)' };

export default async (req) => {
  const p = new URL(req.url).searchParams, n = (k, d) => { const v = parseFloat(p.get(k)); return isFinite(v) ? v : d; };
  const latMin = n('latMin', -78), latMax = n('latMax', 82), lonMin = n('lonMin', -180), lonMax = n('lonMax', 180);
  const budgetMs = Math.min(7000, Math.max(2000, n('ms', 5500)));

  if (typeof WebSocket === 'undefined') return json({ error: 'Node WebSocket unavailable on this runtime (needs Node 22+). Upgrade Node or use /api/vessels.', vessels: [], count: 0 }, 502);

  const ships = new Map();
  let opened = false, closeCode = null, errored = false;

  await new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); }
    catch (e) { errored = true; return resolve(); }
    let settled = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch (e) { } resolve(); };
    const timer = setTimeout(finish, budgetMs);

    ws.onopen = () => {
      opened = true;
      try {
        ws.send(JSON.stringify({
          APIKey: KEY,
          BoundingBoxes: [[[latMin, lonMin], [latMax, lonMax]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        }));
      } catch (e) { }
    };
    ws.onmessage = (ev) => {
      try {
        const raw = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.toString ? ev.data.toString() : '');
        const d = JSON.parse(raw); const md = d.MetaData || {}; const mmsi = md.MMSI;
        if (!mmsi) return;
        if (d.MessageType === 'PositionReport') {
          const pr = (d.Message && d.Message.PositionReport) || {};
          const prev = ships.get(mmsi) || {};
          ships.set(mmsi, Object.assign(prev, {
            mmsi, name: (md.ShipName || prev.name || '').trim(),
            lat: md.latitude, lon: md.longitude,
            sog: pr.Sog != null ? pr.Sog : prev.sog, cog: pr.Cog != null ? pr.Cog : prev.cog,
            hdg: pr.TrueHeading != null ? pr.TrueHeading : prev.hdg,
            nav: pr.NavigationalStatus != null ? pr.NavigationalStatus : prev.nav
          }));
        } else if (d.MessageType === 'ShipStaticData') {
          const sd = (d.Message && d.Message.ShipStaticData) || {};
          const prev = ships.get(mmsi) || { mmsi };
          prev.type = sd.Type != null ? sd.Type : prev.type;
          prev.imo = sd.ImoNumber || prev.imo; prev.dest = (sd.Destination || prev.dest || '').trim();
          if (sd.Name) prev.name = String(sd.Name).trim();
          ships.set(mmsi, prev);
        }
        if (ships.size >= 600) finish();
      } catch (e) { }
    };
    ws.onerror = () => { errored = true; finish(); };
    ws.onclose = (e) => { closeCode = e && e.code; finish(); };
  });

  const vessels = [...ships.values()].filter(v => v.lat != null && v.lon != null)
    .map(v => ({ mmsi: v.mmsi, name: v.name || '', lat: v.lat, lon: v.lon, sog: v.sog, cog: v.cog, hdg: v.hdg, nav: v.nav, navLabel: NAVS[v.nav] || null, type: v.type, imo: v.imo || null, dest: v.dest || '' }));

  if (!vessels.length) {
    return json({
      vessels: [], count: 0, source: 'aisstream',
      error: opened ? ('aisstream connected but sent no positions in ' + budgetMs + 'ms' + (closeCode ? ' (closed ' + closeCode + ')' : ''))
        : (errored ? 'aisstream unreachable from the server (handshake failed)' : 'aisstream did not open')
    }, 502);
  }
  return json({ vessels, count: vessels.length, source: 'aisstream' });
};
