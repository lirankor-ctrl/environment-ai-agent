import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ClassifiedItem } from './types.js';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS_DIR = path.join(ROOT, 'reports');

const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
const LATEST_ITEMS_FILE = path.join(DATA_DIR, 'latest-items.json');
const SCAN_META_FILE = path.join(DATA_DIR, 'scan-meta.json');

export interface SeenStore {
  urls: string[];
  titles: string[];
  updatedAt: string;
}

export interface Seen {
  urls: Set<string>;
  titles: Set<string>;
}

/** Normalize a headline for title-based dedup (handles Google News duplicates). */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // Hebrew niqqud / cantillation
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // drop punctuation/quotes
    .trim()
    .replace(/\s+/g, ' ');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** URLs + normalized titles we've already reported on, to avoid duplicates. */
export async function loadSeen(): Promise<Seen> {
  const store = await readJson<SeenStore>(SEEN_FILE, { urls: [], titles: [], updatedAt: '' });
  return { urls: new Set(store.urls ?? []), titles: new Set(store.titles ?? []) };
}

export async function saveSeen(seen: Seen): Promise<void> {
  await ensureDir(DATA_DIR);
  const store: SeenStore = {
    urls: [...seen.urls],
    titles: [...seen.titles],
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(SEEN_FILE, JSON.stringify(store, null, 2), 'utf8');
}

/** Persist this week's freshly-found, classified items. */
export async function saveLatestItems(items: ClassifiedItem[]): Promise<void> {
  await ensureDir(DATA_DIR);
  await fs.writeFile(LATEST_ITEMS_FILE, JSON.stringify(items, null, 2), 'utf8');
}

export async function loadLatestItems(): Promise<ClassifiedItem[]> {
  return readJson<ClassifiedItem[]>(LATEST_ITEMS_FILE, []);
}

export interface ScanMeta {
  /** Genuinely new items added in the most recent scan run. */
  newItems: number;
  /** Total items in the rolling 7-day cache after the run. */
  totalItems: number;
  /** True when the run found 0 new items but the cache still has fresh items. */
  usedFallback: boolean;
  updatedAt: string;
}

export async function saveScanMeta(meta: Omit<ScanMeta, 'updatedAt'>): Promise<void> {
  await ensureDir(DATA_DIR);
  const full: ScanMeta = { ...meta, updatedAt: new Date().toISOString() };
  await fs.writeFile(SCAN_META_FILE, JSON.stringify(full, null, 2), 'utf8');
}

export async function loadScanMeta(): Promise<ScanMeta | null> {
  return readJson<ScanMeta | null>(SCAN_META_FILE, null);
}

export interface SavedReport {
  date: string;
  mdPath: string;
  htmlPath: string;
}

/** Save the report as dated files plus stable "latest" copies. */
export async function saveReport(markdown: string, html: string): Promise<SavedReport> {
  await ensureDir(REPORTS_DIR);
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(REPORTS_DIR, `report-${date}.md`);
  const htmlPath = path.join(REPORTS_DIR, `report-${date}.html`);

  await fs.writeFile(mdPath, markdown, 'utf8');
  await fs.writeFile(htmlPath, html, 'utf8');
  await fs.writeFile(path.join(REPORTS_DIR, 'latest.md'), markdown, 'utf8');
  await fs.writeFile(path.join(REPORTS_DIR, 'latest.html'), html, 'utf8');

  return { date, mdPath, htmlPath };
}

export async function loadLatestReport(): Promise<{ markdown: string; html: string }> {
  const markdown = await fs.readFile(path.join(REPORTS_DIR, 'latest.md'), 'utf8');
  const html = await fs.readFile(path.join(REPORTS_DIR, 'latest.html'), 'utf8');
  return { markdown, html };
}
