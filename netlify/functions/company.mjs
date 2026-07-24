// Niyantran — Company Search proxy. PRIMARY registry source: ZaubaCorp (mirrors
// free MCA / Ministry of Corporate Affairs master data). Zauba blocks minimal
// browser fetches (403) and is CORS-locked, so this same-origin Function pulls
// the page with a full browser header set and parses the embedded JSON-LD +
// description prose into a structured company profile. Nothing is stored.
//
//   GET /api/company?q=<name>          -> { results:[{name,cin,url}] }
//   GET /api/company?url=<zaubaUrl>    -> { company:{...structured fields...} }
//
// Wikipedia (secondary/supplementary) is fetched client-side (CORS-open).

import https from 'node:https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HDRS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
const CIN_RE = /[LUu]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

// ZaubaCorp is Cloudflare-protected and 403s undici (fetch)'s TLS fingerprint,
// but allows Node's native https stack (same as curl). So we fetch via node:https.
function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('too many redirects'));
    const req = https.request(url, { method: 'GET', headers: HDRS, timeout: 20000 }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.destroy();
        return resolve(httpsGet(new URL(loc, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.destroy(); return resolve({ status: res.statusCode, body: '' }); }
      let data = ''; res.setEncoding('utf8');
      res.on('data', (c) => { data += c; if (data.length > 6e6) { res.destroy(); } });
      res.on('end', () => resolve({ status: 200, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function parseSearch(html) {
  const out = [], seen = {};
  const re = /href="https:\/\/www\.zaubacorp\.com\/([A-Za-z0-9][A-Za-z0-9-]+)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 25) {
    const slug = m[1], name = m[2].replace(/\s+/g, ' ').trim();
    if (!CIN_RE.test(slug) || !name) continue;
    const cin = slug.slice(-21);
    if (seen[cin]) continue; seen[cin] = 1;
    out.push({ name, cin, url: 'https://www.zaubacorp.com/' + slug });
  }
  return out;
}
const grab = (d, re) => { const m = d.match(re); return m ? m[1].trim() : ''; };
function rupees(s) { if (!s) return ''; const n = parseFloat(s); if (!isFinite(n)) return ''; if (n >= 1e7) return '₹' + (n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' L'; return '₹' + n.toLocaleString('en-IN'); }
function parseCompany(html) {
  let ld = null, m; const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = re.exec(html))) { try { const o = JSON.parse(m[1].trim()); if (o && (o['@type'] === 'Organization' || o.identifier)) { ld = o; break; } } catch (e) { } }
  if (!ld) return null;
  const d = ld.description || '';
  const cin = (ld.identifier && ld.identifier.value) || grab(d, /CIN[:\s]+([A-Z0-9]{21})/);
  const directors = (ld.alumni || []).map(p => ({ name: (p.name || '').replace(/\s+/g, ' ').trim(), role: p.jobTitle || '', din: p.identifier || '' })).filter(p => p.name);
  return {
    name: ld.legalName || ld.name || '', cin,
    status: grab(d, /Current status of .*? is\s*-?\s*([A-Za-z ]+?)\./),
    type: grab(d, /is a ([A-Za-z ]+?) company incorporated/),
    classification: grab(d, /classified as ([A-Za-z- ]+?) and is registered/),
    incorporated: ld.foundingDate || '', incorporatedText: grab(d, /incorporated on ([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/),
    roc: grab(d, /registered at ([A-Za-z ,]+?)\./), regNumber: grab(d, /registration number is ([0-9]+)/),
    authCapital: rupees(grab(d, /authorized share capital is Rs\.?\s*([0-9.]+)/)),
    paidCapital: rupees(grab(d, /paid up capital is Rs\.?\s*([0-9.]+)/)),
    lastAGM: grab(d, /AGM\) was last held on ([0-9]{1,2} [A-Za-z]{3} [0-9]{4})/),
    lastBalanceSheet: grab(d, /balance sheet was last filed on ([0-9-]+)/),
    nic: grab(d, /NIC code is ([0-9]+)/), activity: grab(d, /As per the NIC code, it is in[a-z]*ved in ([^.]+)\./),
    email: ld.email || '', address: (ld.address || '').replace(/\s+/g, ' ').replace(/\s,/g, ',').replace(/,\s*,/g, ',').trim(),
    url: ld.url || '', directors, aka: (ld.alternateName || []).slice(0, 6)
  };
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=1800' } });

// ---- OFFICIAL SOURCE: Ministry of Corporate Affairs via data.gov.in --------
// "Registrars of Companies (RoC)-wise Company Master Data" — 3.67M companies,
// the real MCA master record. Free; set DATA_GOV_KEY to your own key (the
// fallback below is data.gov.in's public sample key and is heavily throttled).
// NOTE: this API is EXACT-match only — filters[CompanyName] needs the full
// registered name, and q= does not actually search. So it is the authority for
// detail, not the type-ahead.
const MCA_RES = '4dbe5667-7b6b-41d7-82af-211562424d9a';
const MCA_KEY = process.env.DATA_GOV_KEY || '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';

function mcaUrl(params) {
  const u = new URL('https://api.data.gov.in/resource/' + MCA_RES);
  u.searchParams.set('api-key', MCA_KEY);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '10');
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.href;
}
function mapMca(r) {
  const money = v => { const n = parseFloat(v); if (!isFinite(n)) return ''; if (n >= 1e7) return '₹' + (n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr'; if (n >= 1e5) return '₹' + (n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' L'; return '₹' + n.toLocaleString('en-IN'); };
  return {
    name: r.CompanyName || '', cin: r.CIN || '',
    status: r.CompanyStatus || '', type: r.CompanyClass || '',
    classification: r.CompanySubCategory || '', category: r.CompanyCategory || '',
    incorporated: r.CompanyRegistrationdate_date || '', incorporatedText: r.CompanyRegistrationdate_date || '',
    roc: r.CompanyROCcode || '', regNumber: '',
    authCapital: money(r.AuthorizedCapital), paidCapital: money(r.PaidupCapital),
    listing: r.Listingstatus || '', state: r.CompanyStateCode || '',
    nic: r.nic_code || '', activity: r.CompanyIndustrialClassification || '',
    origin: r['CompanyIndian/Foreign Company'] || '',
    address: (r.Registered_Office_Address || '').replace(/\s+/g, ' ').trim(),
    email: '', directors: [], aka: [], source: 'MCA · data.gov.in'
  };
}
async function mcaLookup(params) {
  const r = await httpsGet(mcaUrl(params));
  if (r.status !== 200) return null;
  try {
    const d = JSON.parse(r.body);
    const recs = d.records || [];
    return recs.length ? recs.map(mapMca) : [];
  } catch (e) { return null; }
}
// the registered name is rarely what a person types
function nameVariants(q) {
  const b = q.trim().toUpperCase().replace(/\s+/g, ' ');
  const bare = b.replace(/\s+(PRIVATE\s+)?LIMITED$|\s+LTD\.?$|\s+PVT\.?\s*LTD\.?$/i, '').trim();
  return [...new Set([b, bare + ' LIMITED', bare + ' PRIVATE LIMITED', bare])];
}

export default async (req) => {
  const p = new URL(req.url).searchParams;
  const q = (p.get('q') || '').trim(), url = (p.get('url') || '').trim();
  const cin = (p.get('cin') || '').trim().toUpperCase();
  try {
    // authoritative record straight from MCA
    if (cin) {
      const recs = await mcaLookup({ 'filters[CIN]': cin });
      if (recs && recs.length) return json({ company: recs[0], source: 'mca' });
      return json({ error: 'CIN not found in MCA master data' }, 404);
    }
    if (url) {
      if (!/^https:\/\/(www\.)?zaubacorp\.com\//i.test(url)) return json({ error: 'bad url' }, 400);
      const r = await httpsGet(url);
      if (r.status !== 200) return json({ error: 'zauba ' + r.status, blocked: r.status === 403 }, 502);
      const co = parseCompany(r.body);
      if (!co) return json({ error: 'no structured data' }, 502);
      return json({ company: co });
    }
    if (q) {
      // 1) ZaubaCorp gives fuzzy/partial name matching (MCA's own API cannot).
      let results = [], zaubaOk = false;
      try {
        const r = await httpsGet('https://www.zaubacorp.com/companysearchresults/' + encodeURIComponent(q));
        if (r.status === 200) { results = parseSearch(r.body); zaubaOk = true; }
      } catch (e) { }

      // 2) Always try MCA directly too — if the user typed a full registered
      //    name (or Zauba is throttled) this is the official answer.
      let mca = [];
      for (const v of nameVariants(q)) {
        const recs = await mcaLookup({ 'filters[CompanyName]': v });
        if (recs && recs.length) { mca = recs; break; }
      }

      if (mca.length) {
        const seen = {};
        const merged = mca.map(m => (seen[m.cin] = 1, { name: m.name, cin: m.cin, url: '', mca: true }))
          .concat(results.filter(x => !seen[x.cin]));
        return json({ results: merged, source: 'mca+zauba', mcaExact: mca.length });
      }
      if (zaubaOk) return json({ results, source: 'zauba' });
      return json({
        error: 'ZaubaCorp is throttling and MCA has no exact match for that name',
        blocked: true, results: [],
        hint: 'MCA master data is exact-match only — try the full registered name (e.g. "INFOSYS LIMITED") or a CIN.'
      }, 502);
    }
    return json({ error: 'pass ?q= or ?url=' }, 400);
  } catch (e) {
    return json({ error: 'fetch failed: ' + (e && e.message) }, 502);
  }
};
