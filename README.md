# Niyantran Terminal

An autonomous, open-source **governance · geopolitics · finance intelligence terminal** for journalists and analysts. India-focused, single-file frontend, **free AI**, and a fleet of scheduled **agents** that keep every feed fresh — no paid backend, no servers to babysit.

- **Free AI** — Groq (fastest free inference) with an automatic **Gemini** fallback. No paid API.
- **Autonomous agents** — GitHub Actions scrape every source **every 6 hours** and commit JSON snapshots. The terminal reads snapshots, so it never waits on a live upstream.
- **Backend dashboard** — `/admin` shows every agent's health, last run, row counts, errors, and a manual "Run now".
- **Store-nothing-heavy** — snapshots are small JSON caches; no database, no user data, no heavy assets on our servers.
- **MIT licensed** — fork it, self-host it, extend it.

---

## Architecture

```
                       ┌─────────────────────────────┐
   GitHub Actions      │  scrapers/  (the agents)     │
   cron: every 6h  ──▶ │  run-all.mjs → sources/*.mjs │ ──▶ commit data/*.json
                       └─────────────────────────────┘             │
                                                                   ▼
   Browser ◀── index.html ◀── reads /data/*.json (snapshots)  +  /api/askai (Groq→Gemini)
                    │                                              +  /api/ais, /api/air (LIVE, on-demand)
                    └── /admin  ◀── /api/admin (health · trigger · AI ping)
```

### Live vs batch (important design decision)
Most feeds — news, conflict wire, tenders, courts, climate, company registry, markets — change slowly enough that a **6-hour batch** is ideal (deduped, enriched, cached, fast). Two feeds are genuinely real-time and are **deliberately not agents**: **ships (AIS)** and **aircraft (OpenSky)**. A 6-hour-old vessel/aircraft position is meaningless, so those stay **on-demand** via their own functions (`/api/ais`, `/api/air`, `/api/vessels`), fetched only when a user opens that panel.

---

## Repo layout

```
index.html                     the entire terminal (single file)
admin/index.html               backend dashboard (agent control)
data/                          agent output — *.json snapshots + _manifest.json (committed by CI)
scrapers/
  run-all.mjs                  the agent runner (node scrapers/run-all.mjs [feed])
  lib/http.mjs                 fetch helper (timeout, retry, entity decode)
  lib/snapshot.mjs             snapshot writer + manifest
  sources/index.mjs            agent registry — add a feed here
  sources/*.mjs                one module per feed (conflict, news, markets, …)
netlify/functions/
  askai.mjs                    FREE AI gateway: Groq → Gemini fallback
  admin.mjs                    dashboard API: health · trigger · AI ping (token-gated)
  ais.mjs air.mjs vessels.mjs  LIVE on-demand feeds (not batched)
  rss.mjs ohlc.mjs company.mjs … other on-demand proxies
.github/workflows/agents.yml   the 6-hourly schedule
```

---

## Run it locally

```bash
# 1. install the Netlify CLI (one time)
npm i -g netlify-cli

# 2. keys — copy the template and fill in at least one AI key
cp .env.example .env
#    GROQ_API_KEY=...     (https://console.groq.com/keys)
#    GEMINI_API_KEY=...   (https://aistudio.google.com/apikey)
#    ADMIN_TOKEN=<any long random string>

# 3. run the agents once to populate data/
node scrapers/run-all.mjs
#    → data/news.json, data/markets.json, data/conflict.json, data/_manifest.json

# 4. serve the terminal + functions
netlify dev
#    terminal  → http://localhost:8888
#    dashboard → http://localhost:8888/admin
```

Run a single agent: `node scrapers/run-all.mjs news`

---

## Deploy (free)

1. **Push to a GitHub repo** (public = fully open-source; `.env` and `*.mp4` are gitignored).
2. **Connect the repo to Netlify** (free tier). Build settings are in `netlify.toml` — no build command needed.
3. **Set environment variables** in Netlify → Site → Environment: `GROQ_API_KEY`, `GEMINI_API_KEY`, `ADMIN_TOKEN`, and (for the dashboard's "Run now") `GITHUB_TOKEN` + `GITHUB_REPO`.
4. **Agents run themselves** — the GitHub Actions workflow fires every 6 hours and commits fresh snapshots. Enable Actions on the repo if prompted, and give it write permission (Settings → Actions → General → Workflow permissions → *Read and write*).

That's the whole backend. No database, no server, ₹0 hosting within free tiers.

---

## Add a new agent

1. Create `scrapers/sources/myfeed.mjs`:
   ```js
   import { get, clean } from '../lib/http.mjs';
   export const id = 'myfeed';
   export const label = 'My Feed';
   export async function run() {
     const r = await get('https://example.com/api', { json: true });
     const rows = r.body.items.map(x => ({ title: clean(x.title), link: x.url }));
     return { rows, source: 'example.com' };
   }
   ```
2. Register it in `scrapers/sources/index.mjs`.
3. Done — `run-all`, the schedule, and the dashboard pick it up automatically. The snapshot lands at `data/myfeed.json`.

---

## Honest limits

- **Free AI has rate limits.** Groq caps requests/minute and /day; Gemini has a generous daily free quota. The fallback smooths over Groq throttling, but at large scale you'd add more keys or a paid tier (the code already supports swapping models via env). Not infinite — just free.
- **Yahoo Finance is unofficial** and delayed; fine for a free product, **not** licensed for commercial redistribution. Swap in a licensed NSE/BSE vendor before charging for it.
- **Per-IP rate limiting is best-effort** (in-memory per warm serverless instance). For hard limits add a shared KV.
- **`data/` snapshots are committed by CI**, so the repo carries a rolling data history. To keep the repo lean, the workflow can be pointed at a separate `data` branch or object storage — see the workflow comments.

## License
MIT — see [LICENSE](LICENSE). Covers the code; live data belongs to its providers under their terms.
