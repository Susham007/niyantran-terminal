NIYANTRAN TERMINAL — deploy (NVIDIA Nemotron "Manthan" AI, zero setup)
=====================================================================

This folder is a complete, self-contained Netlify site. The AI runs through a
serverless function that is part of THIS site (no third-party dependency), and
the NVIDIA key is baked into that function as a default, so it works out of the
box with NO environment variables and NO per-viewer keys.

Folder:
  index.html                       the terminal
  netlify.toml                     Netlify config (functions dir)
  netlify/functions/manthan.mjs    NVIDIA Nemotron proxy (key baked in as default)
  netlify/functions/factcheck.mjs  Google Fact Check Tools proxy (free key baked in as default)
  netlify/functions/ytlive.mjs     Live-stream resolver (current live video per channel; no key)
  netlify/functions/transcribe.mjs Groq Whisper large-v3 proxy (free key baked in) — live transcript
  netlify/functions/askai.mjs      Anthropic Claude proxy (key server-side) — Ask AI web + PDF, cited

------------------------------------------------------------------
DEPLOY — one step
------------------------------------------------------------------
Deploy the WHOLE FOLDER (not just index.html), so the function ships with it:

  • Netlify dashboard → Deploys → drag-and-drop this "niyantran-netlify" folder.
    (Netlify auto-detects the function. Done — it just works.)

  • or CLI:
        npm i -g netlify-cli
        cd niyantran-netlify
        netlify deploy --prod

IMPORTANT: dragging only the single .html file will NOT include the AI function.
Always deploy the folder.

------------------------------------------------------------------
VERIFY
------------------------------------------------------------------
  • Visit  https://YOURSITE/.netlify/functions/manthan   → should say "POST only"
    (means the AI function deployed).
  • Open the site → LIVE TV → each channel now plays its CURRENT live stream.
    (The ytlive function reads the channel's /live page server-side and resolves
    the live video id on the fly — no more stale/old recordings, no API key,
    no quota. Requires deploying the FOLDER so the function ships; a plain .html
    opened from disk can't resolve live and falls back to the built-in ids.)
  • LIVE, BROADCAST-TIED FACT-CHECKING (1 click, no install): in the panel click
    "● Enable live fact-check" → in the browser dialog pick THIS tab, tick
    "Share tab audio", and make sure the channel is un-muted (speaker icon). The
    tab's audio is transcribed by Groq Whisper large-v3 (Hindi + English, free
    key baked into transcribe.mjs) and the feed fills with LIVE verdict cards
    about what's actually being said. Click again to stop. No Python, no server,
    no tunnel. (The one click is a browser rule for capturing audio.)
    Without it, the panel shows the published fact-check feed (below).
  • The right "Live Intelligence"
    panel auto-loads (NO transcription, NO permission, NO cost for the viewer):
      - Fact-check feed: recent PUBLISHED fact-checks for the channel's topics
        (needs a free Google key — see FACT-CHECK KEY below).
      - Check a claim: paste something you heard → a published verdict if one
        exists, else an AI assessment via NVIDIA Nemotron (clearly labelled).
      - About this channel: a short AI context note.

------------------------------------------------------------------
NOTES
------------------------------------------------------------------
  • Model: default is meta/llama-3.1-8b-instruct (~0.6s, reliable JSON).
    Change it any time WITHOUT editing code by setting a Netlify env var:
        NVIDIA_MODEL = nvidia/nemotron-mini-4b-instruct   (absolute fastest)
        NVIDIA_MODEL = nvidia/nemotron-3-nano-30b-a3b     (fast + smarter, MoE)
  • Security: the key sits in the function (server-side) — it is NOT in the page
    and viewers can't see it. For a public production launch, replace it with a
    Netlify env var (NVIDIA_API_KEY) and rotate the baked-in one. For a prototype
    this is fine.
  • Why a function at all: NVIDIA's API sends no CORS headers, so a browser can
    never call it directly; the same-origin function is the only way (and it
    keeps the key off the client). This is part of your own site, not an external
    service.
------------------------------------------------------------------
FACT-CHECK KEY (free — enables the published-fact-check feed)
------------------------------------------------------------------
A free Google Fact Check Tools key is ALREADY baked into factcheck.mjs, so the
feed works out of the box — no setup needed. To use your own key instead (or to
rotate for a real launch), set the Netlify env var GOOGLE_FACTCHECK_KEY; it wins
over the baked default. To get one (~2 minutes):
  1. https://console.cloud.google.com  → create/pick a project
  2. APIs & Services → Library → enable "Fact Check Tools API"
  3. APIs & Services → Credentials → Create credentials → API key
  4. Netlify → Site settings → Environment variables:
        GOOGLE_FACTCHECK_KEY = <that key>
Without it, the feed just shows a note and the "Check a claim" box still works
(via NVIDIA). You can also skip the function and set localStorage.niyGoogleFactKey
in the browser (key visible to that browser only).

NOTE ON GROUNDING: the feed shows PUBLISHED verdicts (fully sourced). For a claim
with no published fact-check, "Check a claim" returns an NVIDIA "AI assessment"
that is clearly labelled as NOT verified. There is deliberately no live
transcription: auto-transcribing YouTube in a browser isn't possible without a
per-viewer screen-share or a dedicated ASR server, so this config drops it.
