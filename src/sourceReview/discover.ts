import Parser from 'rss-parser';
import { log } from '../logger.js';
import { nowMs } from '../clock.js';
import { assessRelevance } from '../relevance.js';
import { decodeGoogleNewsUrl, isGoogleNewsUrl } from '../sources/googleNews.js';
import { httpTry, mapLimit, parseLooseDate } from '../sources/http.js';
import type { RawItem } from '../types.js';
import type { AccessMethod, DiscoveredSource, NewSourceVerdict } from './types.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const parser = new Parser({ timeout: 25000, headers: { 'User-Agent': UA } });

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const RESOLVE_CONCURRENCY = 4;

/** STEP 1 — broad discovery queries covering the seven requested topics. */
const DISCOVERY_QUERIES: string[] = [
  'מחזור ישראל', // Recycling
  'ניהול פסולת ישראל', // Waste management
  'כלכלה מעגלית ישראל', // Circular economy
  'רגולציה סביבתית ישראל', // Environmental regulation
  'קיימות ישראל', // Sustainability
  'זיהום אוויר ישראל', // Air pollution
  'מדיניות אקלים וסביבה ישראל', // Climate & environmental policy
];

/**
 * Publishers we already use or that aren't useful as a standalone "source"
 * (aggregators, social, search). Matched as a hostname suffix.
 */
const KNOWN_DOMAINS = ['infospot.co.il', 'zavit.org.il', 'isees.org.il'];
const EXCLUDED_DOMAINS = [
  'google.com',
  'news.google.com',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'wikipedia.org',
  'gov.il',
];

interface DiscoveryItem extends RawItem {
  publisher: string;
}

/** Split a Google News "Headline - Publisher" title. */
function splitTitle(raw: string): { headline: string; publisher: string } {
  const idx = raw.lastIndexOf(' - ');
  if (idx > 15) {
    return { headline: raw.slice(0, idx).trim(), publisher: raw.slice(idx + 3).trim() };
  }
  return { headline: raw.trim(), publisher: '' };
}

function bareHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isDomainBlocked(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function buildUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:${WINDOW_DAYS}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=he&gl=IL&ceid=IL:he`;
}

/** Run the discovery queries and collect raw items grouped by publisher name. */
async function collectCandidates(): Promise<Map<string, DiscoveryItem[]>> {
  const byPublisher = new Map<string, DiscoveryItem[]>();
  log.info(`Source discovery — running ${DISCOVERY_QUERIES.length} broad queries (last ${WINDOW_DAYS} days):`);

  for (const query of DISCOVERY_QUERIES) {
    let count = 0;
    try {
      const feed = await parser.parseURL(buildUrl(query));
      for (const i of feed.items ?? []) {
        const link = (i.link ?? '').trim();
        const rawTitle = (i.title ?? '').trim();
        if (!link || !rawTitle) continue;
        const { headline, publisher } = splitTitle(rawTitle);
        if (!publisher || /gov\.il/i.test(publisher)) continue;

        const item: DiscoveryItem = {
          title: headline,
          url: link,
          source: publisher,
          publisher,
          publishedAt: parseLooseDate(i.isoDate ?? i.pubDate),
          summary: (i.contentSnippet ?? '').trim().slice(0, 300),
          query,
        };
        const list = byPublisher.get(publisher) ?? [];
        list.push(item);
        byPublisher.set(publisher, list);
        count++;
      }
    } catch (err) {
      log.warn(`  • discovery query failed: "${query}" — ${(err as Error).message}`);
    }
    log.info(`  • "${query}": ${count} items`);
  }
  log.info(`Source discovery — ${byPublisher.size} distinct publishers surfaced.`);
  return byPublisher;
}

/** Probe a domain for an RSS feed and basic HTML accessibility. */
async function probeAccess(domain: string): Promise<AccessMethod> {
  const home = `https://${domain}/`;
  const homeRes = await httpTry(home);
  const html = homeRes.status >= 200 && homeRes.status < 400 && homeRes.data.length > 0;

  const rssCandidates = [
    `https://${domain}/feed`,
    `https://${domain}/feed/`,
    `https://${domain}/rss`,
    `https://${domain}/rss/`,
    `https://${domain}/?feed=rss2`,
  ];
  for (const url of rssCandidates) {
    const res = await httpTry(url);
    if (res.status >= 200 && res.status < 400 && /<(rss|feed|rdf:RDF)/i.test(res.data)) {
      return { rss: true, rssUrl: url, html };
    }
  }
  return { rss: false, html };
}

/** Count how many items fall within the freshness/relevance buckets. */
function countBuckets(items: DiscoveryItem[]): {
  total: number;
  relevant: number;
  dated: number;
} {
  const now = nowMs();
  const maxAge = WINDOW_DAYS * DAY_MS;
  let relevant = 0;
  let dated = 0;
  for (const i of items) {
    if (assessRelevance(i).relevant) relevant++;
    if (i.publishedAt) {
      const ts = Date.parse(i.publishedAt);
      if (Number.isFinite(ts) && now - ts <= maxAge && now - ts >= -DAY_MS) dated++;
    }
  }
  return { total: items.length, relevant, dated };
}

/**
 * Score a candidate 1–10 from: relevance ratio (≤4), 30-day volume (≤2),
 * date coverage (≤2) and accessibility (≤2, RSS beats HTML-only).
 */
function scoreCandidate(
  buckets: { total: number; relevant: number; dated: number },
  access: AccessMethod,
): number {
  const { total, relevant, dated } = buckets;
  const relevanceRatio = total ? relevant / total : 0;
  const dateRatio = total ? dated / total : 0;
  const volume = Math.min(total, 10) / 10;
  const accessScore = access.rss ? 2 : access.html ? 1 : 0;

  const raw = relevanceRatio * 4 + volume * 2 + dateRatio * 2 + accessScore;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function verdictFor(score: number, relevant: number): NewSourceVerdict {
  if (score >= 7 && relevant >= 2) return 'ADD';
  if (score >= 4 && relevant >= 1) return 'OBSERVE';
  return 'SKIP';
}

function reasonFor(
  d: { score: number; relevantCount: number; totalCount: number; access: AccessMethod },
): string {
  const acc = d.access.rss ? 'זמין דרך RSS' : d.access.html ? 'נגיש לגריפת HTML' : 'נגישות מוגבלת';
  return `${d.relevantCount}/${d.totalCount} פריטים רלוונטיים ב-30 הימים האחרונים · ${acc} · ציון ${d.score}/10`;
}

/** STEP 1 + STEP 2 — discover and evaluate new candidate sources. */
export async function discoverSources(): Promise<DiscoveredSource[]> {
  const byPublisher = await collectCandidates();

  // Resolve each publisher to a real domain (decode one Google News link per
  // publisher) and probe accessibility, with bounded concurrency.
  const groups = [...byPublisher.entries()];
  const resolved = await mapLimit(groups, RESOLVE_CONCURRENCY, async ([publisher, items]) => {
    // Find a usable domain: items may already be real URLs, else decode.
    let domain: string | null = null;
    let homepage = '';
    let sampleUrl = items[0]?.url ?? '';
    for (const it of items.slice(0, 4)) {
      let real = it.url;
      if (isGoogleNewsUrl(it.url)) {
        const decoded = await decodeGoogleNewsUrl(it.url);
        if (decoded) real = decoded;
      }
      const host = bareHost(real);
      if (host) {
        domain = host;
        homepage = `https://${host}/`;
        sampleUrl = real;
        break;
      }
    }
    if (!domain) return null;
    if (isDomainBlocked(domain, KNOWN_DOMAINS) || isDomainBlocked(domain, EXCLUDED_DOMAINS)) {
      return null;
    }

    const buckets = countBuckets(items);
    if (buckets.relevant === 0) return null; // not an environmental source

    const access = await probeAccess(domain);
    const score = scoreCandidate(buckets, access);
    const verdict = verdictFor(score, buckets.relevant);
    const d: DiscoveredSource = {
      name: publisher,
      domain,
      url: homepage,
      sampleUrl,
      score,
      totalCount: buckets.total,
      relevantCount: buckets.relevant,
      datedCount: buckets.dated,
      access,
      verdict,
      reason: '',
    };
    d.reason = reasonFor(d);
    return d;
  });

  // De-dup by domain (a publisher may appear under slightly different names),
  // keeping the higher score, and drop SKIP verdicts.
  const byDomain = new Map<string, DiscoveredSource>();
  for (const d of resolved) {
    if (!d || d.verdict === 'SKIP') continue;
    const prev = byDomain.get(d.domain);
    if (!prev || d.score > prev.score) byDomain.set(d.domain, d);
  }

  const out = [...byDomain.values()].sort((a, b) => b.score - a.score);
  log.info(
    `Source discovery — ${out.length} candidate sources (ADD: ${out.filter((d) => d.verdict === 'ADD').length}, OBSERVE: ${out.filter((d) => d.verdict === 'OBSERVE').length}).`,
  );
  return out;
}
