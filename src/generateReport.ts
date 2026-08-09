import { fetchAirQuality } from './airQuality.js';
import { config } from './config.js';
import { nowMs } from './clock.js';
import { log } from './logger.js';
import {
  buildLegislationMarkdown,
  buildNewsletterHtml,
  buildNewsletterMarkdown,
  buildStatusMarkdown,
  FALLBACK_NOTICE,
  REPORT_TITLE,
  selectLegislation,
} from './report.js';
import { loadLatestItems, loadScanMeta, saveReport } from './storage.js';
import { loadLatestReview } from './sourceReview/store.js';
import { buildSourceReviewHtml, buildSourceReviewMarkdown } from './sourceReview/section.js';
import type { ClassifiedItem } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function withinDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  const age = nowMs() - ts;
  return age <= days * DAY_MS && age >= -DAY_MS;
}

/** npm run report — turn the latest scanned items into a Hebrew MD + HTML report. */
async function main(): Promise<void> {
  log.step('REPORT — generating Hebrew weekly report');

  // The extended rolling cache (up to config.extendedWindowDays old) holds
  // every eligible article, not just this run's new discoveries (item 2).
  const cached = await loadLatestItems();

  // Two disjoint pools, derived from the SAME cache:
  //  - weekly:   the primary section — items within the strict weekly window.
  //  - fallback: only used when weekly is unusually thin (item 3) — items
  //              older than the weekly window but within the extended one.
  //              Never overlaps with `weekly` and never mislabeled as "this week".
  const weekly: ClassifiedItem[] = cached.filter((i) => withinDays(i.publishedAt, config.freshnessDays));
  const extendedPool: ClassifiedItem[] = cached.filter(
    (i) => !withinDays(i.publishedAt, config.freshnessDays) && withinDays(i.publishedAt, config.extendedWindowDays),
  );
  const fallbackItems =
    weekly.length < config.minWeeklyItems ? extendedPool.slice(0, 5) : [];

  const meta = await loadScanMeta();
  const isFallback = (meta?.usedFallback ?? false) && weekly.length > 0;

  log.info(`Loaded ${cached.length} cached items (extended ${config.extendedWindowDays}-day window).`);
  log.info(`Weekly window (${config.freshnessDays}d): ${weekly.length} items.`);
  log.info(`Extended-only pool (${config.freshnessDays}-${config.extendedWindowDays}d): ${extendedPool.length} items.`);
  if (fallbackItems.length) {
    log.warn(
      `Weekly count (${weekly.length}) is below the minimum (${config.minWeeklyItems}) — including ${fallbackItems.length} background item(s) from the last ${config.extendedWindowDays} days.`,
    );
  }
  log.info(`New items in latest scan: ${meta?.newItems ?? 'unknown'}`);
  if (isFallback) {
    log.warn('No new items in the latest scan — generating the report from the cached window items (fallback).');
  }

  // Environmental status summary (air quality — air.sviva.gov.il).
  const aqi = await fetchAirQuality();
  log.info(`AQI source: ${aqi.source} (${aqi.diagnostics.fallbackTier})`);
  log.info(`AQI cities retrieved: ${aqi.cities.map((c) => c.city).join(', ') || 'none'}`);
  log.info(`AQI cities missing: ${aqi.missingCities.join(', ') || 'none'}`);

  // Legislation & regulation section (drawn from the weekly pool only).
  const leg = selectLegislation(weekly);
  log.info(`Legislation/regulation items found: ${leg.legal.length}`);
  log.info(`Items rejected as tenders: ${leg.rejectedTender}`);
  log.info(`Items rejected as not legal/regulatory: ${leg.rejectedNotLegal}`);
  log.info('(old/static/gov.il items were already excluded during scan)');

  // Sources & recommendations section (item 9) — optional, skipped if review hasn't run.
  const review = await loadLatestReview();
  if (review) {
    log.info(
      `Source review loaded (${review.date}): ${review.recommendedNew.length} new, ${review.approval.remove.length} to remove, ${review.underObservation.length} observed.`,
    );
  } else {
    log.info('No source review found — newsletter will omit the review section.');
  }
  const reviewMd = review ? `\n${buildSourceReviewMarkdown(review)}` : '';
  const reviewHtml = review ? buildSourceReviewHtml(review) : undefined;

  const dateLine = new Date(nowMs()).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
  const noteMd = isFallback ? `> ${FALLBACK_NOTICE}\n\n` : '';
  const statusMd = buildStatusMarkdown(weekly, aqi);
  const legMd = buildLegislationMarkdown(leg.legal);
  const bodyMd = buildNewsletterMarkdown(weekly, fallbackItems, leg.legal);
  const markdown = `# ${REPORT_TITLE}\n_${dateLine} · חלון טריות: ${config.freshnessDays} ימים אחרונים_\n\n${noteMd}${statusMd}\n${legMd}\n${bodyMd}${reviewMd}`;

  const html = buildNewsletterHtml(weekly, fallbackItems, aqi, leg.legal, {
    fallbackNote: isFallback,
    sourceReviewHtml: reviewHtml,
  });
  const saved = await saveReport(markdown, html);

  log.info(`Markdown: ${saved.mdPath}`);
  log.info(`HTML:     ${saved.htmlPath}`);
  log.info('Also wrote reports/latest.md and reports/latest.html');
  log.step('REPORT — done');
}

main()
  .then(() => {
    // Exit explicitly so lingering HTTP sockets (AQI) don't hold it open.
    log.info('REPORT process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`Report generation crashed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
