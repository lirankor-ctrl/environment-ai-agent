import { fetchAirQuality } from './airQuality.js';
import { config } from './config.js';
import { log } from './logger.js';
import {
  buildLegislationMarkdown,
  buildNewsletterHtml,
  buildStatusMarkdown,
  FALLBACK_NOTICE,
  generateReportMarkdown,
  selectLegislation,
} from './report.js';
import { loadLatestItems, loadScanMeta, saveReport } from './storage.js';

/** npm run report — turn the latest scanned items into a Hebrew MD + HTML report. */
async function main(): Promise<void> {
  log.step('REPORT — generating Hebrew weekly report');

  // Always use the best articles from the last 7 days (rolling cache).
  const cached = await loadLatestItems();
  const maxAge = config.freshnessDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const items = cached.filter((i) => {
    if (!i.publishedAt) return false;
    const ts = Date.parse(i.publishedAt);
    return Number.isFinite(ts) && now - ts <= maxAge;
  });
  const meta = await loadScanMeta();
  const isFallback = (meta?.usedFallback ?? false) && items.length > 0;

  log.info(`Loaded ${cached.length} cached items (${items.length} within the last ${config.freshnessDays} days).`);
  log.info(`New items in latest scan: ${meta?.newItems ?? 'unknown'}`);
  if (isFallback) {
    log.warn('No new items in the latest scan — generating the report from the cached 7-day items (fallback).');
  }
  log.info(`Report generated from: ${isFallback ? 'fallback cache' : 'latest scan'} (${items.length} items).`);

  // Environmental status summary (air quality).
  const aqi = await fetchAirQuality();
  log.info(`AQI source: ${aqi.source}`);
  log.info(`AQI cities retrieved: ${aqi.retrieved.join(', ') || 'none'}`);
  log.info(`AQI cities missing: ${aqi.missing.join(', ') || 'none'}`);

  // Legislation & regulation section.
  const leg = selectLegislation(items);
  log.info(`Legislation/regulation items found: ${leg.legal.length}`);
  log.info(`Items rejected as tenders: ${leg.rejectedTender}`);
  log.info(`Items rejected as not legal/regulatory: ${leg.rejectedNotLegal}`);
  log.info('(old/static/gov.il items were already excluded during scan)');

  const mainMd = await generateReportMarkdown(items);
  const statusMd = buildStatusMarkdown(items, aqi);
  const legMd = buildLegislationMarkdown(leg.legal);
  const noteMd = isFallback ? `> ${FALLBACK_NOTICE}\n\n` : '';
  // Insert note + status + legislation right after the title (before the summary).
  const intro = `\n${noteMd}${statusMd}\n${legMd}\n`;
  const markdown = /^# .+\n/.test(mainMd)
    ? mainMd.replace(/^(# .+\n)/, `$1${intro}`)
    : `${intro}${mainMd}`;
  const html = buildNewsletterHtml(items, aqi, leg.legal, { fallbackNote: isFallback });
  const saved = await saveReport(markdown, html);

  log.info(`Markdown: ${saved.mdPath}`);
  log.info(`HTML:     ${saved.htmlPath}`);
  log.info('Also wrote reports/latest.md and reports/latest.html');
  log.step('REPORT — done');
}

main()
  .then(() => {
    // Exit explicitly so lingering HTTP sockets (AQI/OpenAI) don't hold it open.
    log.info('REPORT process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`Report generation crashed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
