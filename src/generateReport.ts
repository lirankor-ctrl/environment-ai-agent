import { fetchAirQuality } from './airQuality.js';
import { log } from './logger.js';
import {
  buildLegislationMarkdown,
  buildNewsletterHtml,
  buildStatusMarkdown,
  generateReportMarkdown,
  selectLegislation,
} from './report.js';
import { loadLatestItems, saveReport } from './storage.js';

/** npm run report — turn the latest scanned items into a Hebrew MD + HTML report. */
async function main(): Promise<void> {
  log.step('REPORT — generating Hebrew weekly report');
  const items = await loadLatestItems();
  log.info(`Loaded ${items.length} items from data/latest-items.json`);

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
  // Insert status + legislation right after the title (before the executive summary).
  const intro = `\n${statusMd}\n${legMd}\n`;
  const markdown = /^# .+\n/.test(mainMd)
    ? mainMd.replace(/^(# .+\n)/, `$1${intro}`)
    : `${intro}${mainMd}`;
  const html = buildNewsletterHtml(items, aqi, leg.legal);
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
