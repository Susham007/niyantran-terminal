// AGENT: Conflict wire — GDELT 2.0 (free, no key). Deduped by headline, region-tagged.
import { get, clean } from '../lib/http.mjs';

const BASE = '(ceasefire OR airstrike OR "armed conflict" OR insurgency OR shelling OR militants OR offensive OR "peace talks")';
const REGIONS = [
  ['Ukraine / Russia', /ukrain|kyiv|kharkiv|donetsk|russia|moscow|kremlin|zaporizh/i],
  ['Middle East', /gaza|israel|hamas|hezbollah|lebanon|iran|tehran|houthi|yemen|syria|iraq|west bank|idf/i],
  ['Sudan / Horn', /sudan|khartoum|darfur|ethiopia|somalia|eritrea|tigray/i],
  ['Sahel / West Africa', /mali|niger|burkina|chad|sahel|nigeria|boko haram|cameroon/i],
  ['South Asia', /pakistan|afghan|taliban|kashmir|myanmar|burma|bangladesh|sri lanka/i],
  ['East Asia', /taiwan|korea|pyongyang|china|beijing|philippine|south china sea/i],
  ['Americas', /haiti|mexico|colombia|venezuela|ecuador|cartel/i],
  ['Europe', /serbia|kosovo|bosnia|armenia|azerbaijan|georgia|moldova|belarus/i],
  ['Africa (other)', /congo|drc|rwanda|mozambique|libya|m23/i],
];
const regionOf = t => { for (const [n, re] of REGIONS) if (re.test(t)) return n; return 'Other'; };
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const fmtTime = s => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s || ''); return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : (s || ''); };

export const id = 'conflict';
export const label = 'Conflict Wire (GDELT)';

export async function run() {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc'
    + '?query=' + encodeURIComponent(BASE + ' sourcelang:english')
    + '&mode=artlist&maxrecords=250&timespan=2d&sort=datedesc&format=json';
  const r = await get(url, { json: true, timeout: 25000, retries: 2 });
  if (r.status === 429) throw new Error('GDELT rate limit');
  const arts = (r.body && r.body.articles) || [];
  const groups = new Map();
  for (const a of arts) {
    const k = norm(a.title).slice(0, 64);
    if (!k) continue;
    const g = groups.get(k);
    if (g) { g.outlets++; if ((a.seendate || '') > (g.seendate || '')) g.seendate = a.seendate; }
    else groups.set(k, { title: clean(a.title), seendate: a.seendate, domain: a.domain, url: a.url, country: a.sourcecountry, outlets: 1 });
  }
  const rows = [...groups.values()]
    .sort((a, b) => (b.seendate || '').localeCompare(a.seendate || ''))
    .map((x, i) => ({
      id: String(i + 1), time: fmtTime(x.seendate), region: regionOf(x.title),
      source: x.domain || '', title: x.title, outlets: x.outlets > 1 ? String(x.outlets) : '1',
      country: x.country || '', link: x.url || '',
    }));
  return { rows, source: 'GDELT 2.0 DOC API (free, no key)', raw: arts.length };
}
