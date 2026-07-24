// AGENT: News desks — multi-feed RSS with thumbnails. One snapshot, all outlets
// merged and time-sorted, so the terminal's LATEST rail reads a single file.
import { get, clean, decodeEntities } from '../lib/http.mjs';

export const id = 'news';
export const label = 'News Desks (RSS)';

const FEEDS = [
  ['THE HINDU', 'TH', 'https://www.thehindu.com/news/national/feeder/default.rss'],
  ['THE WIRE', 'TW', 'https://cms.thewire.in/feed'],
  ['SCROLL.IN', 'SC', 'https://feeds.feedburner.com/ScrollinArticles.rss'],
  ['OCCRP', 'OC', 'https://www.occrp.org/en/feed'],
];

function pickThumb(itemXml) {
  let m = itemXml.match(/<(?:media:content|media:thumbnail|content|thumbnail)[^>]*\burl="([^"]+)"/i);
  if (m) return m[1];
  m = itemXml.match(/<enclosure[^>]*\burl="([^"]+)"[^>]*type="image/i);
  if (m) return m[1];
  const enc = itemXml.match(/<(?:content:encoded|description)>([\s\S]*?)<\/(?:content:encoded|description)>/i);
  if (enc) { const im = enc[1].match(/<img[^>]*\bsrc=["']([^"']+)["']/i); if (im) return decodeEntities(im[1]); }
  return '';
}
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '(?:[^>]*)>([\\s\\S]*?)</' + name + '>', 'i')); return m ? decodeEntities(clean(m[1].replace(/<!\[CDATA\[|\]\]>/g, ''))) : ''; };

function parse(xml, src, mono) {
  const items = xml.split(/<item[\s>]/i).slice(1).map(s => '<item ' + s);
  return items.slice(0, 12).map(it => {
    let link = (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || (it.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    link = link.replace(/<!\[CDATA\[|\]\]>/g, ''); // Hindu wraps links in CDATA
    const iso = tag(it, 'pubDate') || tag(it, 'dc:date') || '';
    return { title: tag(it, 'title'), link: clean(decodeEntities(link)), img: pickThumb(it), src, mono, pub: iso, ts: Date.parse(iso) || 0 };
  }).filter(r => r.title && /^https?:\/\//i.test(r.link));
}

export async function run() {
  const all = [];
  const per = {};
  await Promise.all(FEEDS.map(async ([src, mono, url]) => {
    try {
      const r = await get(url, { timeout: 20000, retries: 1 });
      const rows = parse(r.body, src, mono);
      per[src] = rows.length;
      all.push(...rows);
    } catch (e) { per[src] = 'ERR: ' + String(e.message || e).slice(0, 60); }
  }));
  all.sort((a, b) => b.ts - a.ts);
  const rows = all.slice(0, 40).map(({ ts, ...r }) => r);
  return { rows, source: 'RSS: The Hindu, The Wire, Scroll, OCCRP', perFeed: per };
}
