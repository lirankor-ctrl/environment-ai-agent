import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  SourceApprovals,
  SourceReviewHistory,
  SourceReviewResult,
} from './types.js';

const DATA_DIR = path.join(process.cwd(), 'data');

const LATEST_FILE = path.join(DATA_DIR, 'source-review.json');
const HISTORY_FILE = path.join(DATA_DIR, 'source-review-history.json');
const APPROVALS_FILE = path.join(DATA_DIR, 'source-approvals.json');

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Latest review result — consumed by the report generator to embed the section. */
export async function saveLatestReview(result: SourceReviewResult): Promise<void> {
  await ensureDir();
  await fs.writeFile(LATEST_FILE, JSON.stringify(result, null, 2), 'utf8');
}

export async function loadLatestReview(): Promise<SourceReviewResult | null> {
  return readJson<SourceReviewResult | null>(LATEST_FILE, null);
}

/** Append-only archive of every recommendation (STEP 6). */
export async function loadHistory(): Promise<SourceReviewHistory> {
  return readJson<SourceReviewHistory>(HISTORY_FILE, { entries: [] });
}

export async function saveHistory(history: SourceReviewHistory): Promise<void> {
  await ensureDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

/** Optional user approvals. Missing file => nothing approved/rejected yet. */
export async function loadApprovals(): Promise<SourceApprovals> {
  const a = await readJson<Partial<SourceApprovals>>(APPROVALS_FILE, {});
  return { approve: a.approve ?? [], reject: a.reject ?? [] };
}
