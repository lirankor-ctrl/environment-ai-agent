import { log } from './logger.js';
import { runSourceReview } from './sourceReview/index.js';

/** npm run review-sources — weekly source discovery & review (STEPS 1–6). */
async function main(): Promise<void> {
  log.step('SOURCE REVIEW — discovering & evaluating sources');
  await runSourceReview();
  log.step('SOURCE REVIEW — done');
}

main()
  .then(() => {
    log.info('SOURCE REVIEW process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    // Never fail the weekly pipeline because discovery had a bad day — the
    // newsletter simply won't include the review section this run.
    log.error(`Source review failed (non-fatal): ${(err as Error).stack ?? err}`);
    process.exit(0);
  });
