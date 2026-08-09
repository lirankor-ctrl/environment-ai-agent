import { log } from '../logger.js';
import { todayIso } from '../clock.js';
import { discoverSources } from './discover.js';
import { reviewExistingSources } from './reviewExisting.js';
import { loadApprovals, loadHistory, saveHistory, saveLatestReview } from './store.js';
import type {
  ApprovalStatus,
  HistoryEntry,
  SourceApprovals,
  SourceReviewResult,
} from './types.js';

const today = todayIso;

function statusFor(key: string, approvals: SourceApprovals): ApprovalStatus {
  if (approvals.approve.includes(key)) return 'approved';
  if (approvals.reject.includes(key)) return 'rejected';
  return 'pending';
}

/**
 * Run the full weekly Source Discovery & Review process (STEPS 1–6) and persist
 * the result + history archive. Never modifies the source list automatically.
 */
export async function runSourceReview(): Promise<SourceReviewResult> {
  const date = today();
  const approvals = await loadApprovals();

  const [discovered, existing] = await Promise.all([
    discoverSources(),
    reviewExistingSources(),
  ]);

  const recommendedNew = discovered.filter((d) => d.verdict === 'ADD');
  const underObservation = discovered.filter((d) => d.verdict === 'OBSERVE');
  const removals = existing.filter((e) => e.recommendation === 'REMOVE');

  // APPROVAL REQUIRED lists only items still awaiting a decision.
  const approval = {
    add: recommendedNew
      .filter((d) => statusFor(d.domain, approvals) === 'pending')
      .map((d) => d.domain),
    remove: removals
      .filter((e) => statusFor(e.id, approvals) === 'pending')
      .map((e) => e.id),
  };

  const result: SourceReviewResult = {
    date,
    recommendedNew,
    underObservation,
    existing,
    approval,
  };

  // STEP 6 — archive every recommendation with its current approval status.
  const newEntries: HistoryEntry[] = [
    ...recommendedNew.map((d) => entry(date, 'new', d.name, d.url, d.score, d.verdict, statusFor(d.domain, approvals), d.reason)),
    ...underObservation.map((d) => entry(date, 'new', d.name, d.url, d.score, d.verdict, statusFor(d.domain, approvals), d.reason)),
    ...existing.map((e) => entry(date, 'existing', e.name, undefined, e.reliabilityScore, e.recommendation, statusFor(e.id, approvals), e.notes)),
  ];
  const history = await loadHistory();
  history.entries.push(...newEntries);

  await saveLatestReview(result);
  await saveHistory(history);

  log.info(
    `Source review saved — ${recommendedNew.length} to add, ${removals.length} to remove, ${underObservation.length} under observation.`,
  );
  log.info(`Archived ${newEntries.length} entries to data/source-review-history.json (total ${history.entries.length}).`);
  return result;
}

function entry(
  date: string,
  kind: HistoryEntry['kind'],
  name: string,
  url: string | undefined,
  score: number,
  recommendation: HistoryEntry['recommendation'],
  approvalStatus: ApprovalStatus,
  notes: string,
): HistoryEntry {
  return { date, kind, name, url, score, recommendation, approvalStatus, notes };
}
