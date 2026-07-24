// Shared HTTP helper for the scraper agents. Node 18+ has global fetch; this
// adds a timeout, a realistic UA, one retry, and redirect following.
export async function get(url, { timeout = 25000, retries = 1, headers = {}, json = false } = {}) {
  const UA = 'Mozilla/5.0 (NiyantranTerminal agent; +https://github.com/)';
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: json ? 'application/json,*/*' : '*/*', ...headers },
        signal: ac.signal,
      });
      clearTimeout(t);
      const body = json ? await r.json() : await r.text();
      return { status: r.status, ok: r.ok, body };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await new Promise(res => setTimeout(res, 1200));
    }
  }
  throw lastErr;
}

export const clean = s => (s || '').replace(/\s+/g, ' ').trim();
export const decodeEntities = s => (s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
