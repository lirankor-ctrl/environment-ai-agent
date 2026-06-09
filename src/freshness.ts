import { config } from './config.js';
import type { RawItem } from './types.js';

export interface FreshnessResult {
  fresh: RawItem[];
  rejectedNoDate: RawItem[];
  rejectedOld: RawItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Strict freshness validation:
 *  - no publication date  -> rejected (rejectedNoDate)
 *  - older than N days     -> rejected (rejectedOld)
 *  - within the last N days -> kept (fresh)
 */
export function validateFreshness(items: RawItem[], days = config.freshnessDays): FreshnessResult {
  const now = Date.now();
  const maxAge = days * DAY_MS;
  const result: FreshnessResult = { fresh: [], rejectedNoDate: [], rejectedOld: [] };

  for (const item of items) {
    if (!item.publishedAt) {
      result.rejectedNoDate.push(item);
      continue;
    }
    const ts = Date.parse(item.publishedAt);
    if (Number.isNaN(ts)) {
      result.rejectedNoDate.push(item);
      continue;
    }
    const age = now - ts;
    // Reject if older than the window. (Future-dated items are treated as fresh.)
    if (age > maxAge) {
      result.rejectedOld.push(item);
      continue;
    }
    result.fresh.push(item);
  }

  return result;
}
