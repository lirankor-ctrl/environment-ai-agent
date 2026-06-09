import axios from 'axios';
import Parser from 'rss-parser';
import { log } from '../logger.js';
import type { RawItem } from '../types.js';
import { httpGet, parseLooseDate } from './http.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const parser = new Parser({ timeout: 25000, headers: { 'User-Agent': UA } });

/** Environmental/recycling/waste keyword queries (Hebrew, Israel-focused). */
export const GOOGLE_NEWS_QUERIES: string[] = [
  'מחזור פסולת ישראל',
  'מיחזור פסולת ישראל',
  'חוק האריזות ישראל',
  'חוק הפיקדון ישראל',
  'פסולת אלקטרונית ישראל',
  'פסולת פלסטיק ישראל',
  'כלכלה מעגלית ישראל',
  'מפעל מחזור ישראל',
  'הטמנה פסולת ישראל',
  'טיפול בפסולת ישראל',
  'זיהום סביבתי ישראל',
  'תאגיד תמיר',
  'אל"ה חוק הפיקדון',
  'מאי פסולת אלקטרונית',
  'ורידיס פסולת',
  'נגב אקולוגיה',
  'RDF ישראל',
  'קומפוסט פסולת ישראל',
  'פסולת בניין ישראל',
];

/** Build the Google News RSS search URL (Hebrew / Israel / last 7 days). */
function buildUrl(query: string): string {
  // "when:7d" biases Google to recent results; our own filter still enforces 7d.
  const q = encodeURIComponent(`${query} when:7d`);
  return `https://news.google.com/rss/search?q=${q}&hl=he&gl=IL&ceid=IL:he`;
}

/** Split Google News "Headline - Publisher" titles. */
function splitTitle(raw: string): { headline: string; publisher: string } {
  const idx = raw.lastIndexOf(' - ');
  if (idx > 15) {
    return { headline: raw.slice(0, idx).trim(), publisher: raw.slice(idx + 3).trim() };
  }
  return { headline: raw.trim(), publisher: '' };
}

/**
 * Run all Google News queries and return raw items, logging the queries and
 * per-query counts. gov.il-published results are dropped (gov.il is excluded).
 */
export async function collectGoogleNews(): Promise<RawItem[]> {
  const all: RawItem[] = [];
  log.info(`Google News RSS — executing ${GOOGLE_NEWS_QUERIES.length} queries:`);

  for (const query of GOOGLE_NEWS_QUERIES) {
    let count = 0;
    try {
      const feed = await parser.parseURL(buildUrl(query));
      for (const i of feed.items ?? []) {
        const link = (i.link ?? '').trim();
        const rawTitle = (i.title ?? '').trim();
        if (!link || !rawTitle) continue;

        const { headline, publisher } = splitTitle(rawTitle);
        // Exclude gov.il publishers entirely.
        if (/gov\.il/i.test(publisher) || /gov\.il/i.test(link)) continue;

        all.push({
          title: headline,
          url: link,
          source: publisher ? `${publisher} (Google News)` : 'Google News',
          publishedAt: parseLooseDate(i.isoDate ?? i.pubDate),
          summary: (i.contentSnippet ?? '').trim().slice(0, 300),
          query,
        });
        count++;
      }
    } catch (err) {
      log.warn(`  • query failed: "${query}" — ${(err as Error).message}`);
    }
    log.info(`  • "${query}": ${count} items`);
  }

  log.info(`Google News RSS — ${all.length} raw items across all queries.`);
  return all;
}

export function isGoogleNewsUrl(url: string): boolean {
  return url.includes('news.google.com');
}

const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';

/**
 * Resolve a Google News redirect URL to the real publisher article URL via
 * Google's batchexecute endpoint. Returns null on any failure (caller keeps the
 * original redirect link). This also yields article-specific images.
 */
export async function decodeGoogleNewsUrl(url: string): Promise<string | null> {
  try {
    const html = await httpGet(url);
    const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    const id = html.match(/data-n-a-id="([^"]+)"/)?.[1];
    if (!sg || !ts || !id) return null;

    const inner = [
      'Fbv4je',
      JSON.stringify([
        'garturlreq',
        [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
          'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
        id, Number(ts), sg,
      ]),
      null,
      'generic',
    ];
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[inner]]));
    const res = await axios.post(BATCH_URL, body, {
      timeout: 25000,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    const txt = String(res.data);
    const all = txt.match(/https?:\/\/[^"\\]+/g) ?? [];
    const real = all.find(
      (u) =>
        !u.includes('news.google') &&
        !u.includes('gstatic') &&
        !u.includes('googleusercontent') &&
        !u.includes('schema.org'),
    );
    return real ? real.replace(/\\u003d/g, '=') : null;
  } catch {
    return null;
  }
}
