// AGENT: Parliament bills — overrides the baked-in national_bill_tracker.csv so
// the Bill Passage Index + Policy Intelligence Graph go genuinely live.
//
// Source: sansad.in (official Parliament of India digital platform). Its bill
// listing is served from a JSON API behind the SPA. The exact endpoint/params
// occasionally change, so this agent is written DEFENSIVELY: it tries the known
// API shapes, normalises whatever it gets into the terminal's CSV schema, and
// throws a clear message (surfaced in the Actions log + admin dashboard) if the
// shape has moved — so it's tuned from a real response, never silently wrong.
//
// Emits rows matching national_bill_tracker.csv:
//   { id, bill_name, house, sector, date_introduced, current_stage,
//     probability_score, summary, source_url }
import { get, clean } from '../lib/http.mjs';

export const id = 'bills';
export const label = 'Parliament Bills (sansad.in)';
export const csvKey = 'national_bill_tracker.csv';   // <- overrides this baked dataset

// Candidate endpoints (sansad.in has migrated these before; first that returns
// a usable array wins). Add/replace here after checking a live response.
const ENDPOINTS = [
  'https://sansad.in/api_ls/legislation/getBillsData?page=0&size=500',
  'https://sansad.in/api/legislation/bills?loksabha=18&size=500',
];

const HOUSE = { ls: 'Lok Sabha', rs: 'Rajya Sabha', lok: 'Lok Sabha', rajya: 'Rajya Sabha' };
function houseOf(v) { v = String(v || '').toLowerCase(); for (const k in HOUSE) if (v.includes(k)) return HOUSE[k]; return v ? clean(v) : ''; }
function dateOf(v) { const m = /(\d{4})[-/](\d{2})[-/](\d{2})|(\d{2})[-/](\d{2})[-/](\d{4})/.exec(String(v || '')); if (!m) return String(v || '').slice(0, 10); return m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`; }

function normalise(arr) {
  return arr.map((b, i) => {
    // Be liberal about field names — different endpoints label them differently.
    const name = b.billName || b.bill_name || b.title || b.name || b.billTitle;
    if (!name) return null;
    return {
      id: String(b.billId || b.id || b.billNo || (i + 1)),
      bill_name: clean(name),
      house: houseOf(b.house || b.billIntroducedIn || b.introducedIn || b.origin),
      sector: clean(b.ministry || b.sector || b.department || b.billCategory || '').toUpperCase(),
      date_introduced: dateOf(b.introducedDate || b.date_introduced || b.billIntroducedDate || b.dateIntroduced),
      current_stage: clean(b.billStatus || b.status || b.current_stage || b.stage || 'Introduced'),
      probability_score: '',
      summary: clean(b.summary || b.billSummary || b.synopsis || ''),
      source_url: b.billUrl || b.url || b.pdfUrl || b.source_url || 'https://sansad.in/ls/legislation/bills',
    };
  }).filter(Boolean);
}

function pickArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  for (const k of ['data', 'records', 'bills', 'result', 'results', 'content', 'list', 'rows']) {
    if (Array.isArray(body[k])) return body[k];
    if (body[k] && Array.isArray(body[k].records)) return body[k].records;
    if (body[k] && Array.isArray(body[k].content)) return body[k].content;
  }
  return null;
}

export async function run() {
  const errors = [];
  for (const url of ENDPOINTS) {
    try {
      const r = await get(url, { json: true, timeout: 25000, retries: 1, headers: { Referer: 'https://sansad.in/' } });
      if (r.status !== 200) { errors.push(`${r.status} @ ${url.slice(0, 48)}`); continue; }
      const arr = pickArray(r.body);
      if (!arr || !arr.length) { errors.push(`no array @ ${url.slice(0, 48)}`); continue; }
      const rows = normalise(arr);
      if (rows.length) return { rows, source: 'sansad.in (Parliament of India, live)' };
      errors.push(`0 usable rows @ ${url.slice(0, 48)}`);
    } catch (e) { errors.push(String(e.message || e).slice(0, 60)); }
  }
  // No endpoint worked — fail loudly so the terminal keeps its baked snapshot
  // and the Actions log tells us exactly what to fix. Never returns fake rows.
  throw new Error('bills source unreachable/changed — ' + errors.join(' | ') + ' (verify endpoint against a live sansad.in response)');
}
