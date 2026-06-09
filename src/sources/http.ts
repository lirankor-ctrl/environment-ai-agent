import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import type { RawItem } from '../types.js';

const UA =
  'Mozilla/5.0 (compatible; IsraelRecyclingAgent/1.0; +https://github.com/) Node.js';

const rss = new Parser({ timeout: 20000, headers: { 'User-Agent': UA } });

export async function httpGet(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: 20000,
    responseType: 'text',
    headers: { 'User-Agent': UA, 'Accept-Language': 'he,en' },
    maxRedirects: 5,
  });
  return res.data;
}

/** GET that never throws on HTTP status — returns the status so callers can skip. */
export async function httpTry(url: string): Promise<{ status: number; data: string }> {
  try {
    const res = await axios.get<string>(url, {
      timeout: 20000,
      responseType: 'text',
      headers: { 'User-Agent': UA, 'Accept-Language': 'he,en' },
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return { status: res.status, data: typeof res.data === 'string' ? res.data : '' };
  } catch {
    return { status: 0, data: '' };
  }
}

/** Decode %-encoded (Hebrew) URLs for substring matching; safe on bad input. */
export function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * URLs we never want: data files, archives, and data-portal/library pages.
 * (Government data portals are excluded entirely.)
 */
export function isIgnoredUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (/\.(xlsx?|csv|pdf|zip|docx?|pptx?|json|xml)(\?|#|$)/.test(u)) return true;
  // gov.il is fully excluded (any subdomain: www / data / e.data …).
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'gov.il' || host.endsWith('.gov.il')) return true;
  } catch {
    // ignore unparseable URLs
  }
  const ignoredPaths = [
    '/dataset',
    '/datasets',
    '/data/',
    '/library',
    '/archive',
    '/sitemap',
    '/api/',
    '/resource',
  ];
  if (ignoredPaths.some((p) => u.includes(p))) return true;
  return false;
}

/** Parse ISO dates and Israeli DD/MM/YYYY (or DD.MM.YYYY) into an ISO string. */
export function parseLooseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const dmy = s.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return undefined;
}

/** Extract a publication date from an article page using several strategies. */
export function extractPublishedDate($: cheerio.CheerioAPI, html: string): string | undefined {
  const metaCandidates = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="publish-date"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
  ];
  for (const sel of metaCandidates) {
    const c = $(sel).attr('content');
    const d = parseLooseDate(c);
    if (d) return d;
  }

  // JSON-LD datePublished
  let ld: string | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    const m = $(el).contents().text().match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (m) ld = m[1];
  });
  if (parseLooseDate(ld)) return parseLooseDate(ld);

  const time = $('time[datetime]').first().attr('datetime');
  if (parseLooseDate(time)) return parseLooseDate(time);

  // Hebrew "פורסם בתאריך: DD/MM/YYYY" (e.g. Infospot).
  const heb = html.match(/פורסם\s*בתאריך[:\s]*([0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{4})/);
  if (heb) return parseLooseDate(heb[1]);

  return undefined;
}

/** Try a list of candidate feed URLs; return items from the first that works. */
export async function tryRss(sourceName: string, urls: string[]): Promise<RawItem[]> {
  for (const url of urls) {
    try {
      const feed = await rss.parseURL(url);
      const items: RawItem[] = (feed.items ?? [])
        .filter((i) => i.link && i.title)
        .map((i) => ({
          title: (i.title ?? '').trim(),
          url: (i.link ?? '').trim(),
          source: sourceName,
          publishedAt: parseLooseDate(i.isoDate ?? i.pubDate),
          summary: (i.contentSnippet ?? i.content ?? '').trim().slice(0, 500),
        }));
      if (items.length) return items;
    } catch {
      // try next candidate
    }
  }
  return [];
}

/** Aggregate items from several RSS feeds (dedup by URL); skips feeds that fail. */
export async function fetchAllRss(sourceName: string, urls: string[]): Promise<RawItem[]> {
  const out: RawItem[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const feed = await rss.parseURL(url);
      for (const i of feed.items ?? []) {
        const link = (i.link ?? '').trim();
        const title = (i.title ?? '').trim();
        if (!link || !title || seen.has(link)) continue;
        seen.add(link);
        out.push({
          title,
          url: link,
          source: sourceName,
          publishedAt: parseLooseDate(i.isoDate ?? i.pubDate),
          summary: (i.contentSnippet ?? i.content ?? '').trim().slice(0, 500),
        });
      }
    } catch {
      // feed blocked or invalid — skip it
    }
  }
  return out;
}

/**
 * Cheap listing scrape: collect article links + headline text from a listing
 * page. No per-article fetch happens here (that's done later, only for new URLs).
 */
export async function scrapeList(opts: {
  sourceName: string;
  listUrl: string;
  linkSelector: string;
  baseUrl?: string;
  limit?: number;
}): Promise<RawItem[]> {
  const html = await httpGet(opts.listUrl);
  const $ = cheerio.load(html);
  const base = opts.baseUrl ?? new URL(opts.listUrl).origin;
  const seen = new Set<string>();
  const items: RawItem[] = [];

  $(opts.linkSelector).each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !title || title.length < 8) return;
    let url: string;
    try {
      url = new URL(href, base).toString();
    } catch {
      return;
    }
    if (seen.has(url) || isIgnoredUrl(url)) return;
    seen.add(url);
    items.push({ title, url, source: opts.sourceName });
  });

  return items.slice(0, opts.limit ?? 40);
}

/** Run an async mapper over items with bounded concurrency. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export interface ImageResult {
  url: string;
  source: 'og:image' | 'twitter:image' | 'article-img';
}

const BAD_IMAGE = /(logo|icon|avatar|sprite|placeholder|blank|pixel|spacer|1x1|loader|emoji|flag|share|whatsapp|facebook|twitter|default)/i;

function validImageUrl(src: string | undefined, pageUrl: string): string | undefined {
  if (!src) return undefined;
  const s = src.trim();
  if (!s || s.startsWith('data:') || /\.svg(\?|#|$)/i.test(s)) return undefined;
  try {
    const abs = new URL(s, pageUrl).toString();
    return abs.startsWith('http') ? abs : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract the main article image:
 *   og:image -> twitter:image -> first relevant content <img>.
 * Returns null when nothing suitable is found (never a random image).
 */
export function extractImage($: cheerio.CheerioAPI, pageUrl: string): ImageResult | null {
  const og =
    validImageUrl($('meta[property="og:image"]').attr('content'), pageUrl) ??
    validImageUrl($('meta[property="og:image:url"]').attr('content'), pageUrl);
  if (og) return { url: og, source: 'og:image' };

  const tw =
    validImageUrl($('meta[name="twitter:image"]').attr('content'), pageUrl) ??
    validImageUrl($('meta[property="twitter:image"]').attr('content'), pageUrl);
  if (tw) return { url: tw, source: 'twitter:image' };

  let found: string | undefined;
  $('article img, .entry-content img, .post-content img, .post img, main img, img').each((_, el) => {
    if (found) return;
    const raw = $(el).attr('src') ?? $(el).attr('data-src') ?? $(el).attr('data-lazy-src');
    if (raw && BAD_IMAGE.test(raw)) return;
    const abs = validImageUrl(raw, pageUrl);
    if (abs) found = abs;
  });
  if (found) return { url: found, source: 'article-img' };

  return null;
}

/** Fetch an article page and extract its main image (null on any failure). */
export async function fetchArticleImage(url: string): Promise<ImageResult | null> {
  try {
    const html = await httpGet(url);
    const $ = cheerio.load(html);
    return extractImage($, url);
  } catch {
    return null;
  }
}

/**
 * Fetch an article page and attach its publication date (plus a better
 * title/summary when available). Leaves items that already have a date alone.
 */
export async function enrichWithDate(item: RawItem): Promise<RawItem> {
  if (item.publishedAt) return item;
  try {
    const html = await httpGet(item.url);
    const $ = cheerio.load(html);
    const publishedAt = extractPublishedDate($, html);
    const desc =
      $('meta[property="og:description"]').attr('content') ??
      $('meta[name="description"]').attr('content');
    const ogTitle = $('meta[property="og:title"]').attr('content');
    return {
      ...item,
      publishedAt,
      title: item.title || (ogTitle?.trim() ?? item.title),
      summary: item.summary || (desc ? desc.trim().slice(0, 500) : undefined),
    };
  } catch {
    return item; // no date -> will be rejected by the freshness step
  }
}
