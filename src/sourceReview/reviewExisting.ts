import { log } from '../logger.js';
import { nowMs } from '../clock.js';
import { assessRelevance } from '../relevance.js';
import { SOURCES, type Source } from '../sources/index.js';
import { enrichWithDate, mapLimit } from '../sources/http.js';
import type { RawItem } from '../types.js';
import type { ExistingSourceReview, Recommendation } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const ENRICH_CONCURRENCY = 5;
const ENRICH_CAP = 20; // don't fetch every undated article during review

function isFresh(item: RawItem): boolean {
  if (!item.publishedAt) return false;
  const ts = Date.parse(item.publishedAt);
  if (!Number.isFinite(ts)) return false;
  const age = nowMs() - ts;
  return age <= WINDOW_DAYS * DAY_MS && age >= -DAY_MS;
}

/**
 * Reliability 1–10 from: did it return items, share of dated items, and the
 * share of useful (relevant + fresh) items.
 */
function reliability(total: number, dated: number, useful: number): number {
  if (total === 0) return 1;
  const dateRatio = dated / total;
  const usefulRatio = useful / total;
  const raw = 3 + dateRatio * 3 + usefulRatio * 4;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function recommend(
  id: string,
  collected: boolean,
  useful: number,
  fresh: number,
): Recommendation {
  // Google News is the keyword discovery layer, not a removable feed.
  if (id === 'google-news') return 'KEEP';
  if (!collected) return 'REMOVE';
  if (useful >= 2) return 'KEEP';
  if (fresh > 0) return 'MONITOR';
  return 'REMOVE';
}

async function reviewOne(source: Source): Promise<ExistingSourceReview> {
  let items: RawItem[] = [];
  let collected = true;
  try {
    items = await source.collect();
  } catch (err) {
    collected = false;
    log.warn(`Review: ${source.name} collect failed — ${(err as Error).message}`);
  }

  // Enrich a bounded number of undated items so scrape-based sources aren't
  // unfairly judged as stale (RSS feeds usually already carry dates).
  const undated = items.filter((i) => !i.publishedAt).slice(0, ENRICH_CAP);
  if (undated.length) {
    const enriched = await mapLimit(undated, ENRICH_CONCURRENCY, (i) => enrichWithDate(i));
    const byUrl = new Map(enriched.map((e) => [e.url, e]));
    items = items.map((i) => byUrl.get(i.url) ?? i);
  }

  let relevantArticles = 0;
  let usefulCount = 0;
  let irrelevantCount = 0;
  let freshCount = 0;
  let datedCount = 0;
  for (const i of items) {
    const rel = assessRelevance(i);
    if (rel.relevant) relevantArticles++;
    else irrelevantCount++;
    if (i.publishedAt) datedCount++;
    const fresh = isFresh(i);
    if (fresh) freshCount++;
    if (rel.relevant && fresh) usefulCount++;
  }

  const scannedCount = items.length;
  const relevanceScore = scannedCount
    ? Math.max(1, Math.min(10, Math.round((relevantArticles / scannedCount) * 10)))
    : 1;
  const reliabilityScore = reliability(scannedCount, datedCount, usefulCount);
  const recommendation = recommend(source.id, collected, usefulCount, freshCount);
  const notes = collected
    ? `${usefulCount} שימושיים · ${irrelevantCount} לא רלוונטיים · ${freshCount} טריים (30 ימים) · אמינות ${reliabilityScore}/10`
    : 'המקור לא הגיב בהרצה זו (כשל איסוף).';

  return {
    id: source.id,
    name: source.name,
    scannedCount,
    relevantArticles,
    usefulCount,
    irrelevantCount,
    freshCount,
    relevanceScore,
    reliabilityScore,
    recommendation,
    notes,
  };
}

/** STEP 3 — review every currently-configured source over the last 30 days. */
export async function reviewExistingSources(): Promise<ExistingSourceReview[]> {
  log.info(`Reviewing ${SOURCES.length} configured sources over the last ${WINDOW_DAYS} days…`);
  const reviews: ExistingSourceReview[] = [];
  for (const source of SOURCES) {
    reviews.push(await reviewOne(source));
  }
  for (const r of reviews) {
    log.info(`  • ${r.recommendation.padEnd(7)} ${r.name} — ${r.notes}`);
  }
  return reviews;
}
