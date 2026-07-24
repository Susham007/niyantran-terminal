#!/usr/bin/env node
// The autonomous agent runner. GitHub Actions calls this every 6 hours:
//   node scrapers/run-all.mjs
// It runs every registered source, writes data/<feed>.json, and updates
// data/_manifest.json with each feed's health. Failures are isolated — one
// dead upstream never blocks the others, and a failed feed keeps its last-good
// snapshot (the manifest just marks it stale).
//
// Run a single feed:  node scrapers/run-all.mjs conflict
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SOURCES } from './sources/index.mjs';
import { writeSnapshot, readManifest, writeManifest, DATA_DIR } from './lib/snapshot.mjs';

const only = process.argv[2];
const started = new Date().toISOString();

const list = only ? SOURCES.filter(s => s.id === only) : SOURCES;
if (only && !list.length) { console.error('No such feed: ' + only + ' (have: ' + SOURCES.map(s => s.id).join(', ') + ')'); process.exit(1); }

const manifest = await readManifest();
manifest.feeds = manifest.feeds || {};
let okCount = 0, failCount = 0;
const datasets = {};   // csvKey -> snapshot id, for the terminal's live-override enabler

for (const src of list) {
  const t0 = Date.now();
  try {
    const payload = await src.run();
    const doc = await writeSnapshot(src.id, payload, { source: payload.source });
    const ms = Date.now() - t0;
    manifest.feeds[src.id] = { label: src.label, ok: true, count: doc.count, ms, updated: doc.updated, source: payload.source || '', error: null };
    // A source that overrides a baked-in CSV registers it so the frontend swaps it live.
    if (src.csvKey && doc.count) datasets[src.csvKey] = src.id;
    okCount++;
    console.log(`[OK]   ${src.id.padEnd(10)} ${String(doc.count).padStart(4)} rows  ${ms}ms`);
  } catch (e) {
    const ms = Date.now() - t0;
    const prev = manifest.feeds[src.id] || {};
    manifest.feeds[src.id] = { label: src.label, ok: false, count: prev.count || 0, ms, updated: prev.updated || null, source: prev.source || '', error: String((e && e.message) || e).slice(0, 200), lastTried: new Date().toISOString() };
    failCount++;
    console.error(`[FAIL] ${src.id.padEnd(10)} ${String((e && e.message) || e).slice(0, 80)}`);
  }
}

manifest.updated = new Date().toISOString();
manifest.startedAt = started;
manifest.summary = { total: list.length, ok: okCount, failed: failCount };
await writeManifest(manifest);

// CSV-override map for the terminal's live-override enabler. Merge with any
// existing file so a single-feed run doesn't wipe other datasets' entries.
let existingDs = {};
try { const { readFile } = await import('node:fs/promises'); existingDs = (JSON.parse(await readFile(join(DATA_DIR, '_datasets.json'), 'utf8')).datasets) || {}; } catch { existingDs = {}; }
const mergedDs = { ...existingDs, ...datasets };
await writeFile(join(DATA_DIR, '_datasets.json'), JSON.stringify({ datasets: mergedDs, updated: manifest.updated }, null, 2), 'utf8');
if (Object.keys(datasets).length) console.log('Live-override datasets this run: ' + Object.keys(datasets).join(', '));

console.log(`\nAgents done: ${okCount} ok, ${failCount} failed of ${list.length}. Manifest -> data/_manifest.json`);
// Non-zero exit only if EVERYTHING failed (so a single dead feed doesn't fail the CI run).
process.exit(okCount === 0 && list.length > 0 ? 1 : 0);
