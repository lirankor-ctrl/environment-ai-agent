import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';
import { loadLatestItems } from './storage.js';
import { loadHistory, loadLatestReview } from './sourceReview/store.js';
import type {
  DiscoveredSource,
  ExistingSourceReview,
  SourceReviewResult,
} from './sourceReview/types.js';
import type { ClassifiedItem } from './types.js';

const TITLE = 'סקירת מקורות חודשית – הדגמה';
const DEMO_NOTE =
  'דוח הדגמה (Dry Run) — מופק מהנתונים והיסטוריית המקורות הקיימים. אינו משנה את רשימת המקורות.';

function reportDate(): string {
  return new Date().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- Coverage analysis (section 5) ----------------

const LEGAL_TERMS = [
  'חוק', 'תקנה', 'תקנות', 'רגולציה', 'חקיקה', 'תזכיר', 'הצעת חוק', 'תיקון', 'רפורמה',
  'ועדת', 'כתב אישום', 'תביעה', 'בג"ץ', 'עתירה', 'קנס', 'עיצום', 'אכיפה', 'צו ',
];

interface TopicCoverage {
  label: string; // English label (as requested)
  he: string; // Hebrew label
  count: number;
}

function textOf(i: ClassifiedItem): string {
  return `${i.title} ${i.summary ?? ''}`;
}

/** Count corpus coverage for the six requested topics. */
function analyzeCoverage(items: ClassifiedItem[]): TopicCoverage[] {
  const has = (i: ClassifiedItem, terms: string[]) => terms.some((t) => textOf(i).includes(t));
  const cat = (i: ClassifiedItem, c: string) => i.categories.includes(c as ClassifiedItem['categories'][number]);

  return [
    {
      label: 'Recycling',
      he: 'מחזור',
      count: items.filter((i) => cat(i, 'מחזור') || cat(i, 'מחזור פלסטיק')).length,
    },
    {
      label: 'Waste management',
      he: 'ניהול פסולת',
      count: items.filter((i) => cat(i, 'ניהול פסולת')).length,
    },
    {
      label: 'Regulation',
      he: 'רגולציה',
      count: items.filter((i) => has(i, LEGAL_TERMS)).length,
    },
    {
      label: 'Packaging',
      he: 'אריזות',
      count: items.filter((i) => has(i, ['אריז', 'פיקדון'])).length,
    },
    {
      label: 'Electronic waste',
      he: 'פסולת אלקטרונית',
      count: items.filter((i) => cat(i, 'פסולת אלקטרונית') || has(i, ['אלקטרונ'])).length,
    },
    {
      label: 'Circular economy',
      he: 'כלכלה מעגלית',
      count: items.filter((i) => cat(i, 'כלכלה מעגלית')).length,
    },
  ];
}

const WELL_THRESHOLD = 2; // ≥2 items in the corpus => "covered well"

// ---------------- Markdown report ----------------

function existingRowMd(r: ExistingSourceReview): string {
  return `| ${r.name} | ${r.scannedCount} | ${r.relevantArticles} | ${r.freshCount} | ${r.relevanceScore}/10 | ${r.recommendation} |`;
}

function newSourceMd(d: DiscoveredSource): string {
  return [
    `* **${d.name}**`,
    `  * URL: ${d.url}`,
    `  * Score: ${d.score}/10`,
    `  * Why it may be useful: ${d.reason}`,
  ].join('\n');
}

function buildMarkdown(
  review: SourceReviewResult,
  coverage: TopicCoverage[],
  archiveCount: number,
): string {
  const removals = review.existing.filter((e) => e.recommendation === 'REMOVE');
  const well = coverage.filter((c) => c.count >= WELL_THRESHOLD);
  const under = coverage.filter((c) => c.count < WELL_THRESHOLD);

  const table = [
    '| Source | Articles scanned | Relevant | Fresh | Relevance score | Recommendation |',
    '| --- | ---: | ---: | ---: | :---: | :---: |',
    ...review.existing.map(existingRowMd),
  ].join('\n');

  const newBlock = review.recommendedNew.length
    ? review.recommendedNew.map(newSourceMd).join('\n')
    : '* אין מקורות חדשים מומלצים.';
  const removalBlock = removals.length
    ? removals.map((r) => `* **${r.name}** — ${r.notes}`).join('\n')
    : '* אין מקורות המומלצים להסרה.';
  const observeBlock = review.underObservation.length
    ? review.underObservation.map((d) => `* **${d.name}** (${d.url}) — ${d.reason}`).join('\n')
    : '* אין מקורות במעקב.';

  const wellBlock = well.length
    ? well.map((c) => `* ${c.label} (${c.he}): ${c.count} פריטים`).join('\n')
    : '* —';
  const underBlock = under.length
    ? under.map((c) => `* ${c.label} (${c.he}): ${c.count} פריטים`).join('\n')
    : '* —';

  const approvalAdd = review.approval.add.length
    ? review.approval.add.map((d) => `* ${d}`).join('\n')
    : '* (none)';
  const approvalRemove = review.approval.remove.length
    ? review.approval.remove.map((id) => `* ${id}`).join('\n')
    : '* (none)';

  return `# ${TITLE}

_${reportDate()} · ${DEMO_NOTE}_

## 1. Source Performance Table

${table}

## 2. Recommended New Sources

${newBlock}

## 3. Sources Recommended For Removal

${removalBlock}

## 4. Sources Under Observation

${observeBlock}

## 5. Coverage Analysis

**נושאים בעלי כיסוי טוב:**

${wellBlock}

**נושאים בתת-כיסוי:**

${underBlock}

## 6. Approval Section

**APPROVAL REQUIRED**

_לא מבוצעים שינויים אוטומטית. (ארכיון המלצות: ${archiveCount} רשומות.)_

Recommended additions:

${approvalAdd}

Recommended removals:

${approvalRemove}
`;
}

// ---------------- HTML report ----------------

const RECO_COLOR: Record<string, string> = {
  KEEP: '#166534',
  MONITOR: '#b45309',
  REMOVE: '#b91c1c',
};

function existingRowHtml(r: ExistingSourceReview): string {
  const color = RECO_COLOR[r.recommendation] ?? '#374151';
  return `<tr>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;">${esc(r.name)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:center;">${r.scannedCount}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:center;">${r.relevantArticles}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:center;">${r.freshCount}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:center;">${r.relevanceScore}/10</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef0f2;text-align:center;font-weight:bold;color:${color};">${r.recommendation}</td>
  </tr>`;
}

function newSourceHtml(d: DiscoveredSource): string {
  return `<li style="margin:8px 0;font-size:14px;line-height:1.5;">
    <a href="${esc(d.url)}" target="_blank" style="color:#15803d;text-decoration:none;font-weight:bold;">${esc(d.name)}</a>
    <span style="display:inline-block;background:#166534;color:#fff;font-size:11px;font-weight:bold;padding:1px 7px;border-radius:10px;margin-inline-start:6px;">${d.score}/10</span>
    <div style="color:#6b7280;font-size:12px;">${esc(d.url)}</div>
    <div style="color:#4b5563;font-size:13px;">${esc(d.reason)}</div>
  </li>`;
}

function topicRowHtml(c: TopicCoverage, well: boolean): string {
  const color = well ? '#166534' : '#b45309';
  const bg = well ? '#dcfce7' : '#fef9c3';
  return `<li style="margin:5px 0;font-size:14px;">
    <b>${c.label}</b> <span style="color:#6b7280;">(${esc(c.he)})</span>
    <span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:bold;padding:1px 8px;border-radius:10px;margin-inline-start:6px;">${c.count} פריטים</span>
  </li>`;
}

function buildHtml(
  review: SourceReviewResult,
  coverage: TopicCoverage[],
  archiveCount: number,
): string {
  const removals = review.existing.filter((e) => e.recommendation === 'REMOVE');
  const well = coverage.filter((c) => c.count >= WELL_THRESHOLD);
  const under = coverage.filter((c) => c.count < WELL_THRESHOLD);

  const rows = review.existing.map(existingRowHtml).join('');
  const newList = review.recommendedNew.length
    ? review.recommendedNew.map(newSourceHtml).join('')
    : '<li style="color:#6b7280;font-size:13px;">אין מקורות חדשים מומלצים.</li>';
  const removalList = removals.length
    ? removals
        .map(
          (r) =>
            `<li style="margin:6px 0;font-size:14px;"><b>${esc(r.name)}</b><div style="color:#4b5563;font-size:13px;">${esc(r.notes)}</div></li>`,
        )
        .join('')
    : '<li style="color:#6b7280;font-size:13px;">אין מקורות המומלצים להסרה.</li>';
  const observeList = review.underObservation.length
    ? review.underObservation
        .map(
          (d) =>
            `<li style="margin:6px 0;font-size:14px;"><b>${esc(d.name)}</b><div style="color:#4b5563;font-size:13px;">${esc(d.reason)}</div></li>`,
        )
        .join('')
    : '<li style="color:#6b7280;font-size:13px;">אין מקורות במעקב.</li>';
  const wellList = well.length
    ? well.map((c) => topicRowHtml(c, true)).join('')
    : '<li style="color:#6b7280;font-size:13px;">—</li>';
  const underList = under.length
    ? under.map((c) => topicRowHtml(c, false)).join('')
    : '<li style="color:#6b7280;font-size:13px;">—</li>';
  const approvalAdd = review.approval.add.length
    ? review.approval.add.map((d) => `<li style="margin:3px 0;">${esc(d)}</li>`).join('')
    : '<li style="margin:3px 0;color:#6b7280;">—</li>';
  const approvalRemove = review.approval.remove.length
    ? review.approval.remove.map((id) => `<li style="margin:3px 0;">${esc(id)}</li>`).join('')
    : '<li style="margin:3px 0;color:#6b7280;">—</li>';

  const sectionHead = (n: string) =>
    `<h2 style="margin:22px 0 8px;color:#14532d;font-size:18px;border-bottom:1px solid #dcfce7;padding-bottom:4px;">${n}</h2>`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${TITLE}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;">
  <tr><td align="center" style="padding:16px 10px;">
    <table role="presentation" width="700" cellpadding="0" cellspacing="0" border="0" dir="rtl"
           style="width:100%;max-width:700px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
      <tr><td style="background:#14532d;padding:20px;">
        <div style="color:#ffffff;font-size:21px;font-weight:bold;">${TITLE}</div>
        <div style="color:#bbf7d0;font-size:13px;margin-top:4px;">${reportDate()}</div>
      </td></tr>
      <tr><td style="padding:10px 20px;background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13px;">${esc(DEMO_NOTE)}</td></tr>
      <tr><td style="padding:8px 24px 24px;">
        ${sectionHead('1. Source Performance Table')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;border:1px solid #eef0f2;border-radius:8px;overflow:hidden;">
          <tr style="background:#ecfdf5;">
            <th style="padding:8px 10px;text-align:right;color:#14532d;">Source</th>
            <th style="padding:8px 10px;color:#14532d;">Articles scanned</th>
            <th style="padding:8px 10px;color:#14532d;">Relevant</th>
            <th style="padding:8px 10px;color:#14532d;">Fresh</th>
            <th style="padding:8px 10px;color:#14532d;">Relevance score</th>
            <th style="padding:8px 10px;color:#14532d;">Recommendation</th>
          </tr>
          ${rows}
        </table>

        ${sectionHead('2. Recommended New Sources')}
        <ul style="margin:0;padding-inline-start:20px;">${newList}</ul>

        ${sectionHead('3. Sources Recommended For Removal')}
        <ul style="margin:0;padding-inline-start:20px;">${removalList}</ul>

        ${sectionHead('4. Sources Under Observation')}
        <ul style="margin:0;padding-inline-start:20px;">${observeList}</ul>

        ${sectionHead('5. Coverage Analysis')}
        <div style="font-size:14px;color:#374151;font-weight:bold;margin:6px 0 2px;">נושאים בעלי כיסוי טוב:</div>
        <ul style="margin:0 0 10px;padding-inline-start:20px;">${wellList}</ul>
        <div style="font-size:14px;color:#374151;font-weight:bold;margin:6px 0 2px;">נושאים בתת-כיסוי:</div>
        <ul style="margin:0;padding-inline-start:20px;">${underList}</ul>

        ${sectionHead('6. Approval Section')}
        <div style="padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
          <div style="font-weight:bold;color:#92400e;font-size:15px;">APPROVAL REQUIRED</div>
          <div style="color:#92400e;font-size:12px;margin:4px 0 8px;">לא מבוצעים שינויים אוטומטית. (ארכיון המלצות: ${archiveCount} רשומות.)</div>
          <div style="font-size:13px;color:#374151;">Recommended additions:</div>
          <ul style="margin:2px 0 6px;padding-inline-start:20px;font-size:13px;">${approvalAdd}</ul>
          <div style="font-size:13px;color:#374151;">Recommended removals:</div>
          <ul style="margin:2px 0 0;padding-inline-start:20px;font-size:13px;">${approvalRemove}</ul>
        </div>
      </td></tr>
      <tr><td style="padding:14px 20px;background:#f9fafb;border-top:1px solid #eee;color:#9ca3af;font-size:12px;">
        הופק אוטומטית כהדגמה (Dry Run) על ידי שכבת Source Discovery &amp; Review.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** npm run review-demo — build the simulated monthly Source Review demo report. */
async function main(): Promise<void> {
  log.step('SOURCE REVIEW DEMO — building report');

  const review = await loadLatestReview();
  if (!review) {
    throw new Error('No data/source-review.json found — run `npm run review-sources` first.');
  }
  const items = await loadLatestItems();
  const history = await loadHistory();
  const coverage = analyzeCoverage(items);

  log.info(`Sources reviewed: ${review.existing.length} · corpus items: ${items.length} · archive: ${history.entries.length}`);

  const markdown = buildMarkdown(review, coverage, history.entries.length);
  const html = buildHtml(review, coverage, history.entries.length);

  const reportsDir = path.join(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const mdPath = path.join(reportsDir, 'source-review-demo.md');
  const htmlPath = path.join(reportsDir, 'source-review-demo.html');
  await fs.writeFile(mdPath, markdown, 'utf8');
  await fs.writeFile(htmlPath, html, 'utf8');

  log.info(`Markdown: ${mdPath}`);
  log.info(`HTML:     ${htmlPath}`);
  log.step('SOURCE REVIEW DEMO — done');
}

main()
  .then(() => {
    log.info('SOURCE REVIEW DEMO process exiting successfully');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`Demo report failed: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
