/**
 * Reference-clock abstraction. All freshness/window calculations must go
 * through here instead of calling Date.now()/new Date() directly, so a run
 * can be pinned to a specific reference date for deterministic testing
 * (REPORT_AS_OF=YYYY-MM-DD), while production runs use the real clock.
 */
const AS_OF = process.env.REPORT_AS_OF?.trim();
const OVERRIDE_MS = AS_OF ? Date.parse(`${AS_OF}T12:00:00.000Z`) : NaN;

if (AS_OF && Number.isNaN(OVERRIDE_MS)) {
  throw new Error(`REPORT_AS_OF is not a valid date: "${AS_OF}"`);
}

/** True when the run is pinned to a fixed reference date (test mode). */
export const isPinned = Number.isFinite(OVERRIDE_MS);

/** Current reference time, in ms since epoch. */
export function nowMs(): number {
  return isPinned ? OVERRIDE_MS : Date.now();
}

/** Current reference time, as a Date. */
export function now(): Date {
  return new Date(nowMs());
}

/** Reference date as YYYY-MM-DD. */
export function todayIso(): string {
  return now().toISOString().slice(0, 10);
}
