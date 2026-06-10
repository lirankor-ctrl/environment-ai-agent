import { config } from './config.js';
import { classify } from './classify.js';
import { validateFreshness } from './freshness.js';
import { log } from './logger.js';
import { assessRelevance } from './relevance.js';
import { SOURCES, type Source } from './sources/index.js';
import { decodeGoogleNewsUrl, isGoogleNewsUrl } from './sources/googleNews.js';
import { enrichWithDate, fetchArticleImage, isIgnoredUrl, mapLimit } from './sources/http.js';
import { loadSeen, normalizeTitle, saveLatestItems, saveSeen, type Seen } from './storage.js';
import type { ClassifiedItem, RawItem } from './types.js';

const ENRICH_CONCURRENCY = 5;

interface SourceStats {
  name: string;
  tier: Source['tier'];
  found: number;
  duplicates: number;
  rejectedStatic: number;
  keywordMatches: number;
  rejectedIrrelevant: number;
  rejectedEvents: number;
  rejectedForeign: number;
  rejectedOld: number;
  included: number;
}

async function processSource(
  source: Source,
  seen: Seen,
): Promise<{ stats: SourceStats; items: ClassifiedItem[] }> {
  const stats: SourceStats = {
    name: source.name,
    tier: source.tier,
    found: 0,
    duplicates: 0,
    rejectedStatic: 0,
    keywordMatches: 0,
    rejectedIrrelevant: 0,
    rejectedEvents: 0,
    rejectedForeign: 0,
    rejectedOld: 0,
    included: 0,
  };

  let collected: RawItem[] = [];
  try {
    collected = await source.collect();
  } catch (err) {
    log.error(`${source.name}: collect failed — ${(err as Error).message}`);
    return { stats, items: [] };
  }
  stats.found = collected.length;

  const candidates: RawItem[] = [];
  for (const item of collected) {
    if (!item.url) continue;
    const nt = normalizeTitle(item.title);

    // Dedup by URL OR normalized title (collapses Google News cross-publisher dupes).
    if (seen.urls.has(item.url) || (nt && seen.titles.has(nt))) {
      stats.duplicates++;
      continue;
    }
    seen.urls.add(item.url);
    if (nt) seen.titles.add(nt);

    if (isIgnoredUrl(item.url) || source.isStatic?.(item.url, item.title)) {
      stats.rejectedStatic++;
      continue;
    }

    const rel = assessRelevance(item);
    if (rel.reason === 'no-keyword') {
      stats.rejectedIrrelevant++;
      continue;
    }
    stats.keywordMatches++;
    if (rel.reason === 'event') {
      stats.rejectedEvents++;
      continue;
    }
    if (rel.reason === 'negative') {
      stats.rejectedIrrelevant++;
      continue;
    }
    if (rel.reason === 'foreign') {
      stats.rejectedForeign++;
      continue;
    }
    candidates.push(item);
  }

  // Fetch article pages only for relevant items still missing a date.
  const enriched = await mapLimit(candidates, ENRICH_CONCURRENCY, (i) => enrichWithDate(i));

  const { fresh, rejectedNoDate, rejectedOld } = validateFreshness(enriched, config.freshnessDays);
  stats.rejectedOld = rejectedNoDate.length + rejectedOld.length;

  const classified = fresh.map(classify);
  stats.included = classified.length;

  return { stats, items: classified };
}

/** npm run scan — Google News keyword search + secondary sources, filtered. */
async function main(): Promise<void> {
  log.step('SCAN — collecting current news');
  const seen = await loadSeen();
  log.info(`Loaded ${seen.urls.size} seen URLs / ${seen.titles.size} seen titles.`);

  const allStats: SourceStats[] = [];
  const allItems: ClassifiedItem[] = [];

  for (const source of SOURCES) {
    log.info(`— scanning [${source.tier}] ${source.name}…`);
    const { stats, items } = await processSource(source, seen);
    allStats.push(stats);
    allItems.push(...items);
  }

  // Sort by importance then by detail (longer title+summary = more detailed),
  // then collapse near-duplicate stories (same event from several outlets).
  const ranked = allItems.sort((a, b) => rank(b) - rank(a) || detail(b) - detail(a));
  const classified = nearDedupe(ranked);
  const nearDupsRemoved = ranked.length - classified.length;

  // Resolve Google News redirect links to real publisher URLs (better links +
  // enables article-specific images). Failures keep the original redirect.
  let resolved = 0;
  await mapLimit(classified, ENRICH_CONCURRENCY, async (i) => {
    if (!isGoogleNewsUrl(i.url)) return null;
    const real = await decodeGoogleNewsUrl(i.url);
    if (real) {
      i.url = real;
      resolved++;
    }
    return null;
  });
  log.info(`Resolved ${resolved} Google News links to source URLs.`);

  // Image enrichment for the items shown as visual cards (hero + top stories).
  // Skip any link still on news.google.com (its og:image is a generic logo).
  const IMAGE_COUNT = 6;
  const visual = classified.slice(0, IMAGE_COUNT);
  const imgResults = await mapLimit(visual, ENRICH_CONCURRENCY, (i) =>
    isGoogleNewsUrl(i.url) ? Promise.resolve(null) : fetchArticleImage(i.url),
  );
  const imgSrc = { 'og:image': 0, 'twitter:image': 0, 'article-img': 0 };
  let withImage = 0;
  visual.forEach((it, idx) => {
    const r = imgResults[idx];
    if (r) {
      it.imageUrl = r.url;
      it.imageSource = r.source;
      withImage++;
      imgSrc[r.source]++;
    }
  });

  // ---- Per-source logging ----
  log.step('SCAN — results per source');
  for (const s of allStats) {
    log.info(`Source [${s.tier}]: ${s.name}`);
    log.info(`    Links found:                ${s.found}`);
    log.info(`    Duplicates removed:         ${s.duplicates}`);
    log.info(`    Rejected static/directory:  ${s.rejectedStatic}`);
    log.info(`    Keyword matches:            ${s.keywordMatches}`);
    log.info(`    Rejected irrelevant:        ${s.rejectedIrrelevant}`);
    log.info(`    Rejected events/tours:      ${s.rejectedEvents}`);
    log.info(`    Rejected non-Israeli:       ${s.rejectedForeign}`);
    log.info(`    Rejected too old/undated:   ${s.rejectedOld}`);
    log.info(`    Included fresh articles:    ${s.included}`);
  }

  const t = allStats.reduce(
    (acc, s) => ({
      found: acc.found + s.found,
      duplicates: acc.duplicates + s.duplicates,
      rejectedStatic: acc.rejectedStatic + s.rejectedStatic,
      keywordMatches: acc.keywordMatches + s.keywordMatches,
      rejectedIrrelevant: acc.rejectedIrrelevant + s.rejectedIrrelevant,
      rejectedEvents: acc.rejectedEvents + s.rejectedEvents,
      rejectedForeign: acc.rejectedForeign + s.rejectedForeign,
      rejectedOld: acc.rejectedOld + s.rejectedOld,
      included: acc.included + s.included,
    }),
    {
      found: 0, duplicates: 0, rejectedStatic: 0, keywordMatches: 0,
      rejectedIrrelevant: 0, rejectedEvents: 0, rejectedForeign: 0, rejectedOld: 0, included: 0,
    },
  );
  log.step('SCAN — totals');
  log.info(`Links found:                ${t.found}`);
  log.info(`Duplicates removed:         ${t.duplicates + nearDupsRemoved} (exact ${t.duplicates} + near ${nearDupsRemoved})`);
  log.info(`Rejected static/directory:  ${t.rejectedStatic}`);
  log.info(`Keyword matches:            ${t.keywordMatches}`);
  log.info(`Rejected irrelevant:        ${t.rejectedIrrelevant}`);
  log.info(`Rejected events/tours:      ${t.rejectedEvents}`);
  log.info(`Rejected non-Israeli:       ${t.rejectedForeign}`);
  log.info(`Rejected too old/undated:   ${t.rejectedOld}`);
  log.info(`Included fresh articles:    ${classified.length}`);

  if (classified.length) {
    log.info('— included articles:');
    for (const i of classified) {
      log.info(`    [${i.importance}] [${fmt(i.publishedAt)}] ${i.title} — ${i.source}`);
    }
  }
  if (classified.length < 5) {
    log.warn(`Only ${classified.length} relevant fresh items this week (target is 5–15).`);
  }

  log.step('SCAN — images (top stories)');
  log.info(`Articles with image found:  ${withImage}`);
  log.info(`Articles without image:     ${visual.length - withImage}`);
  log.info(
    `Image source — og:image: ${imgSrc['og:image']} · twitter:image: ${imgSrc['twitter:image']} · article-img: ${imgSrc['article-img']}`,
  );

  await saveLatestItems(classified);
  await saveSeen(seen);
  log.info(`Saved ${classified.length} fresh items to data/latest-items.json`);
  log.step('SCAN — done');
}

// Generic waste vocabulary — shared occurrences of these don't prove "same story".
const GENERIC_TOKENS = new Set([
  'פסולת', 'מחזור', 'מיחזור', 'אריזות', 'פלסטיק', 'זיהום', 'סביבה', 'סביבתי',
  'ישראל', 'חוק', 'איכות', 'כלכלה', 'מעגלית', 'מתקן', 'עירייה',
]);
const STOP_TOKENS = new Set([
  'של', 'עם', 'על', 'את', 'אל', 'כי', 'גם', 'הוא', 'היא', 'זה', 'זו', 'או', 'כך',
  'עד', 'כל', 'אך', 'בין', 'לפי', 'הם', 'הן', 'עוד', 'אחרי', 'לפני', 'כדי', 'יותר',
]);

/** Significant tokens of a title for near-duplicate comparison. */
function sigTokens(title: string): Set<string> {
  const toks = normalizeTitle(title)
    .split(' ')
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP_TOKENS.has(w));
  return new Set(toks);
}

/** Two titles describe the same story if they share enough specific tokens. */
function isNearDup(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  let nonGeneric = 0;
  for (const w of a) {
    if (b.has(w)) {
      shared++;
      if (!GENERIC_TOKENS.has(w)) nonGeneric++;
    }
  }
  return shared >= 3 && nonGeneric >= 2;
}

/**
 * Collapse near-duplicate stories (e.g. the same event reported by several
 * outlets). Items must arrive pre-sorted by importance+detail so the strongest,
 * most detailed version is the one kept.
 */
function nearDedupe(items: ClassifiedItem[]): ClassifiedItem[] {
  const kept: ClassifiedItem[] = [];
  const keptTokens: Set<string>[] = [];
  for (const item of items) {
    const toks = sigTokens(item.title);
    if (keptTokens.some((k) => isNearDup(toks, k))) continue;
    kept.push(item);
    keptTokens.push(toks);
  }
  return kept;
}

function detail(i: ClassifiedItem): number {
  return (i.title + (i.summary ?? '')).length;
}

function rank(i: ClassifiedItem): number {
  const lvl = i.importance === 'High' ? 3000 : i.importance === 'Medium' ? 2000 : 1000;
  const recency = i.publishedAt ? Date.parse(i.publishedAt) / 1e10 : 0;
  return lvl + recency;
}

function fmt(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('he-IL') : '—';
}

main()
  .then(() => {
    // All work is finished and persisted. Exit explicitly so lingering HTTP
    // sockets / keep-alive handles can't hold the process open (CI hang fix).
    log.info('SCAN process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`Scan crashed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
