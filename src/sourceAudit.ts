import { config } from './config.js';
import { todayIso } from './clock.js';
import type { Source } from './sources/index.js';

/** Per-source diagnostics for one scan run (item 7 — source audit report). */
export interface SourceStats {
  name: string;
  tier: Source['tier'];
  /** Every configured source is always attempted. */
  attempted: true;
  /** False only when collect() threw (network/parse failure) — a fully blocked source. */
  accessible: boolean;
  error?: string;
  found: number;
  duplicates: number;
  rejectedStatic: number;
  keywordMatches: number;
  rejectedIrrelevant: number;
  rejectedEvents: number;
  rejectedForeign: number;
  /** Candidates that survived relevance filtering but had no parseable date at all. */
  rejectedUndated: number;
  /** Candidates with a date, but older than the freshness window. */
  rejectedOldDate: number;
  /** Relevant candidates that did carry a usable publication date. */
  datedCandidates: number;
  /** Fresh + relevant + dated — the articles actually included in the report cache. */
  included: number;
}

export function newSourceStats(source: Source): SourceStats {
  return {
    name: source.name,
    tier: source.tier,
    attempted: true,
    accessible: true,
    found: 0,
    duplicates: 0,
    rejectedStatic: 0,
    keywordMatches: 0,
    rejectedIrrelevant: 0,
    rejectedEvents: 0,
    rejectedForeign: 0,
    rejectedUndated: 0,
    rejectedOldDate: 0,
    datedCandidates: 0,
    included: 0,
  };
}

export interface SourceAudit {
  date: string;
  freshnessDays: number;
  extendedWindowDays: number;
  sources: SourceStats[];
}

export function buildSourceAudit(sources: SourceStats[]): SourceAudit {
  return {
    date: todayIso(),
    freshnessDays: config.freshnessDays,
    extendedWindowDays: config.extendedWindowDays,
    sources,
  };
}

function accessLabel(s: SourceStats): string {
  if (!s.accessible) return `Blocked — ${s.error ?? 'collect() failed'}`;
  return 'Accessible';
}

/** STEP 7 — Markdown per-source diagnostic report. */
export function renderSourceAuditMarkdown(audit: SourceAudit): string {
  const rows = audit.sources
    .map(
      (s) => `### ${s.name} (${s.tier})

* Attempted: yes
* Status: ${accessLabel(s)}
* Candidates discovered: ${s.found}
* Duplicates removed: ${s.duplicates}
* Rejected static/directory/dictionary pages: ${s.rejectedStatic}
* Keyword matches (relevance stage 1): ${s.keywordMatches}
* Rejected — irrelevant topic: ${s.rejectedIrrelevant}
* Rejected — events/tours: ${s.rejectedEvents}
* Rejected — non-Israeli: ${s.rejectedForeign}
* Dated candidates: ${s.datedCandidates}
* Rejected — no publication date found: ${s.rejectedUndated}
* Rejected — older than ${audit.freshnessDays} days: ${s.rejectedOldDate}
* Fresh relevant candidates / final articles included: ${s.included}`,
    )
    .join('\n\n');

  const totals = audit.sources.reduce(
    (acc, s) => ({
      found: acc.found + s.found,
      included: acc.included + s.included,
      blocked: acc.blocked + (s.accessible ? 0 : 1),
    }),
    { found: 0, included: 0, blocked: 0 },
  );

  return `# Source Audit — ${audit.date}

_Freshness window: ${audit.freshnessDays} days · Extended cache window: ${audit.extendedWindowDays} days_

**Summary:** ${audit.sources.length} sources attempted, ${totals.blocked} blocked, ${totals.found} total candidates discovered, ${totals.included} articles included in the report cache.

${rows}
`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function row(label: string, value: string | number): string {
  return `<tr><td style="padding:3px 10px 3px 0;color:#6b7280;">${esc(label)}</td><td style="padding:3px 0;font-weight:bold;">${esc(String(value))}</td></tr>`;
}

/** STEP 7 — HTML per-source diagnostic report (standalone page). */
export function renderSourceAuditHtml(audit: SourceAudit): string {
  const cards = audit.sources
    .map((s) => {
      const statusColor = s.accessible ? '#166534' : '#b91c1c';
      return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:14px;">
      <h3 style="margin:0 0 4px;color:#14532d;">${esc(s.name)} <span style="font-size:12px;color:#6b7280;">(${esc(s.tier)})</span></h3>
      <div style="color:${statusColor};font-weight:bold;font-size:13px;margin-bottom:8px;">${esc(accessLabel(s))}</div>
      <table style="font-size:13px;border-collapse:collapse;">
        ${row('Candidates discovered', s.found)}
        ${row('Duplicates removed', s.duplicates)}
        ${row('Rejected static/directory/dictionary', s.rejectedStatic)}
        ${row('Keyword matches', s.keywordMatches)}
        ${row('Rejected — irrelevant topic', s.rejectedIrrelevant)}
        ${row('Rejected — events/tours', s.rejectedEvents)}
        ${row('Rejected — non-Israeli', s.rejectedForeign)}
        ${row('Dated candidates', s.datedCandidates)}
        ${row('Rejected — no publication date', s.rejectedUndated)}
        ${row(`Rejected — older than ${audit.freshnessDays}d`, s.rejectedOldDate)}
        ${row('Fresh relevant / included', s.included)}
      </table>
    </div>`;
    })
    .join('');

  const totals = audit.sources.reduce(
    (acc, s) => ({
      found: acc.found + s.found,
      included: acc.included + s.included,
      blocked: acc.blocked + (s.accessible ? 0 : 1),
    }),
    { found: 0, included: 0, blocked: 0 },
  );

  return `<!doctype html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8" /><title>Source Audit — ${esc(audit.date)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f3f4f6;padding:20px;color:#111827;">
  <h1 style="color:#14532d;">Source Audit — ${esc(audit.date)}</h1>
  <p style="color:#6b7280;">Freshness window: ${audit.freshnessDays} days · Extended cache window: ${audit.extendedWindowDays} days</p>
  <p><b>${audit.sources.length}</b> sources attempted, <b>${totals.blocked}</b> blocked, <b>${totals.found}</b> total candidates discovered, <b>${totals.included}</b> articles included in the report cache.</p>
  ${cards}
</body>
</html>`;
}
