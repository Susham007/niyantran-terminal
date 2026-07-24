// Snapshot writer + manifest. Every agent writes ONE file: data/<feed>.json.
// A shared data/_manifest.json records the health of every feed so the admin
// dashboard can render "last run / count / ok / ms" without reading each file.
//
// Doctrine note: snapshots are small JSON caches (news rows, market points),
// not heavy assets — consistent with "store nothing heavy". They exist so the
// terminal reads instant, pre-deduped data instead of hammering upstream APIs.
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // niyantran-netlify/
const DATA_DIR = join(ROOT, 'data');
const MANIFEST = join(DATA_DIR, '_manifest.json');

export async function writeSnapshot(feed, payload, meta = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const now = new Date().toISOString();
  const rows = Array.isArray(payload) ? payload : (payload && payload.rows) || [];
  const doc = {
    feed,
    updated: now,
    count: Array.isArray(rows) ? rows.length : 0,
    source: meta.source || '',
    ...(Array.isArray(payload) ? { rows: payload } : payload),
  };
  await writeFile(join(DATA_DIR, feed + '.json'), JSON.stringify(doc), 'utf8');
  return doc;
}

export async function readManifest() {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')); }
  catch { return { updated: null, feeds: {} }; }
}

export async function writeManifest(manifest) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
}

export { DATA_DIR };
