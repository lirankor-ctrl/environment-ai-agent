import { sendReportEmail } from './email.js';
import { log } from './logger.js';
import { loadLatestReport } from './storage.js';

/** npm run email-report — email the latest generated report (respects SEND_EMAIL). */
async function main(): Promise<void> {
  log.step('EMAIL — sending weekly report');
  let report;
  try {
    report = await loadLatestReport();
  } catch {
    throw new Error('No report found. Run "npm run report" first.');
  }
  await sendReportEmail(report.html, report.markdown);
  log.step('EMAIL — done');
}

main()
  .then(() => {
    // Exit explicitly — the SMTP transport can otherwise keep the process alive.
    log.info('EMAIL process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`Email step crashed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
