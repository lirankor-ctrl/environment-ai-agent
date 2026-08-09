import * as cheerio from 'cheerio';
import { log } from '../logger.js';
import { extractPublishedDate, httpTry, parseLooseDate, sanitizeSummary } from './http.js';
import type { RawItem } from '../types.js';

const BASE = 'https://infospot.co.il';

// The homepage only surfaces a handful of teaser links — the full, dated news
// listing lives at /nl/חדשות. Both are scanned; homepage first so a fresh
// front-page story is never missed if it hasn't reached the listing yet.
const LISTING_URLS = [`${BASE}/`, `${BASE}/nl/${encodeURIComponent('חדשות')}`];

/**
 * infospot.co.il uses one-letter path prefixes per content type. Only /n/ is
 * an actual news article — everything else is a dictionary/topic page,
 * company directory, tender board, event calendar or static page and must
 * never be treated as news.
 */
const REJECTED: Array<{ prefix: string; reason: string }> = [
  { prefix: '/scp/', reason: 'dictionary/topic page' },
  { prefix: '/dp/', reason: 'dictionary/definitions page' },
  { prefix: '/gl/', reason: 'glossary page' },
  { prefix: '/la/', reason: 'law-text page' },
  { prefix: '/lal/', reason: 'law index page' },
  { prefix: '/a/', reason: 'tender board' },
  { prefix: '/evl/', reason: 'events listing' },
  { prefix: '/ev/', reason: 'event page' },
  { prefix: '/cml/', reason: 'company listing' },
  { prefix: '/cm/', reason: 'company profile page' },
  { prefix: '/f/', reason: 'static page' },
  { prefix: '/c/', reason: 'static page' },
  { prefix: '/l/', reason: 'static page' },
];

function rejectReason(pathname: string): string | null {
  if (pathname.startsWith('/n/')) return null;
  return REJECTED.find((r) => pathname.startsWith(r.prefix))?.reason ?? 'non-news path';
}

interface Candidate {
  title: string;
  url: string;
  summary?: string;
  dateRaw?: string;
}

/** Parse the news-listing markup: repeated `.option4_main_box` blocks. */
function parseListing(html: string, baseUrl: string): Candidate[] {
  const $ = cheerio.load(html);
  const out: Candidate[] = [];
  $('.option4_main_box').each((_, el) => {
    const box = $(el);
    const a = box.find('.option4_main_box_heading a').first();
    const href = a.attr('href');
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!href || !title) return;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const summary = box.find('.option4_main_box_text_inner').first().text().replace(/\s+/g, ' ').trim();
    // The date sits in the first <td> of the small info table under the box.
    const dateRaw = box.find('table td').first().text().replace(/\s+/g, ' ').trim();
    out.push({ title, url, summary: summary || undefined, dateRaw: dateRaw || undefined });
  });
  return out;
}

/**
 * Dedicated Infospot parser (item 1). Scans the current news listing (not
 * just the homepage), extracts title/URL/date/summary, opens the article
 * page only when the listing didn't carry a date, rejects non-news pages by
 * path, and never lets one bad page fail the whole scan.
 */
export async function collectInfospot(): Promise<RawItem[]> {
  const seenUrls = new Set<string>();
  const candidates: Candidate[] = [];

  for (const listUrl of LISTING_URLS) {
    const res = await httpTry(listUrl);
    if (res.status < 200 || res.status >= 400 || !res.data) {
      log.warn(`Infospot: listing page unavailable (${listUrl}) — status ${res.status}`);
      continue;
    }
    const found = parseListing(res.data, listUrl);
    log.info(`Infospot: ${found.length} link(s) found on ${listUrl}`);
    for (const c of found) {
      if (seenUrls.has(c.url)) continue;
      seenUrls.add(c.url);
      candidates.push(c);
    }
  }
  log.info(`Infospot: ${candidates.length} distinct URLs discovered across listing pages.`);

  const items: RawItem[] = [];
  let accepted = 0;
  let rejected = 0;

  for (const c of candidates) {
    let pathname: string;
    try {
      pathname = new URL(c.url).pathname;
    } catch {
      rejected++;
      log.info(`Infospot REJECT (unparseable URL): ${c.url}`);
      continue;
    }

    const reason = rejectReason(pathname);
    if (reason) {
      rejected++;
      log.info(`Infospot REJECT (${reason}): ${c.url}`);
      continue;
    }

    let publishedAt = parseLooseDate(c.dateRaw);
    let summary = sanitizeSummary(c.summary);

    // Listing markup didn't carry a usable date — open the article page.
    // A single failed page is logged and skipped; it never fails the scan.
    if (!publishedAt) {
      const page = await httpTry(c.url);
      if (page.status >= 200 && page.status < 400 && page.data) {
        const $$ = cheerio.load(page.data);
        publishedAt = extractPublishedDate($$, page.data);
        if (!summary) {
          const desc =
            $$('.article_itelic_short').first().text().trim() ||
            $$('meta[property="og:description"]').attr('content') ||
            $$('meta[name="description"]').attr('content');
          summary = sanitizeSummary(desc);
        }
      } else {
        log.warn(`Infospot: could not open article page (${c.url}) — status ${page.status}`);
      }
    }

    log.info(`Infospot DATE: ${c.url} -> ${publishedAt ?? 'none extracted'}`);

    if (!publishedAt) {
      rejected++;
      log.info(`Infospot REJECT (no publication date found): ${c.url}`);
      continue;
    }

    accepted++;
    log.info(`Infospot ACCEPT: [${publishedAt}] ${c.title} — ${c.url}`);
    items.push({ title: c.title, url: c.url, source: 'Infospot', publishedAt, summary });
  }

  log.info(`Infospot: ${accepted} accepted, ${rejected} rejected.`);
  return items;
}

/** Defense-in-depth: matches the parser's own reject list by path. */
export function isInfospotStatic(url: string): boolean {
  try {
    return rejectReason(new URL(url).pathname) !== null;
  } catch {
    return true;
  }
}
