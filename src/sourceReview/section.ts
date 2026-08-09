import type {
  DiscoveredSource,
  ExistingSourceReview,
  SourceReviewResult,
} from './types.js';

const SECTION_TITLE = 'מקורות והמלצות למעקב';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------- Markdown (plain-text report) ----------------

function newSourceMd(d: DiscoveredSource): string {
  return [
    `* **${d.name}**`,
    `  * URL: ${d.url}`,
    `  * Score: ${d.score}/10`,
    `  * Reason: ${d.reason}`,
  ].join('\n');
}

function removalMd(r: ExistingSourceReview): string {
  return `* **${r.name}** — ${r.notes}`;
}

function observationMd(d: DiscoveredSource): string {
  return `* **${d.name}** (${d.url}) — ${d.reason}`;
}

/** STEP 4 + STEP 5 — the Markdown "Source Review & Recommendations" section. */
export function buildSourceReviewMarkdown(result: SourceReviewResult): string {
  const removals = result.existing.filter((e) => e.recommendation === 'REMOVE');

  const newBlock = result.recommendedNew.length
    ? result.recommendedNew.map(newSourceMd).join('\n')
    : '* אין מקורות חדשים מומלצים השבוע.';
  const removalBlock = removals.length
    ? removals.map(removalMd).join('\n')
    : '* אין מקורות המומלצים להסרה השבוע.';
  const observeBlock = result.underObservation.length
    ? result.underObservation.map(observationMd).join('\n')
    : '* אין מקורות במעקב השבוע.';

  const approvalAdd = result.approval.add.length
    ? result.approval.add.map((d) => `* ${d}`).join('\n')
    : '* (none)';
  const approvalRemove = result.approval.remove.length
    ? result.approval.remove.map((id) => `* ${id}`).join('\n')
    : '* (none)';

  return `## ${SECTION_TITLE}

### מקורות חדשים מומלצים

${newBlock}

### מקורות המומלצים להסרה

${removalBlock}

### מקורות במעקב

${observeBlock}

---

**APPROVAL REQUIRED**

_שינויים ברשימת המקורות לא יוחלו אוטומטית. לאישור — ערכו את \`data/source-approvals.json\`._

Add:

${approvalAdd}

Remove:

${approvalRemove}
`;
}

// ---------------- HTML (newsletter section) ----------------

function newSourceHtml(d: DiscoveredSource): string {
  return `<li style="margin:8px 0;font-size:14px;line-height:1.5;">
    <a href="${esc(d.url)}" target="_blank" style="color:#15803d;text-decoration:none;font-weight:bold;">${esc(d.name)}</a>
    <span style="display:inline-block;background:#166534;color:#fff;font-size:11px;font-weight:bold;padding:1px 7px;border-radius:10px;margin-inline-start:6px;">${d.score}/10</span>
    <div style="color:#6b7280;font-size:12px;">${esc(d.url)}</div>
    <div style="color:#4b5563;font-size:13px;">${esc(d.reason)}</div>
  </li>`;
}

function removalHtml(r: ExistingSourceReview): string {
  return `<li style="margin:6px 0;font-size:14px;line-height:1.5;">
    <b>${esc(r.name)}</b>
    <div style="color:#4b5563;font-size:13px;">${esc(r.notes)}</div>
  </li>`;
}

function observationHtml(d: DiscoveredSource): string {
  return `<li style="margin:6px 0;font-size:14px;line-height:1.5;">
    <b>${esc(d.name)}</b>
    <div style="color:#4b5563;font-size:13px;">${esc(d.reason)}</div>
  </li>`;
}

function subhead(text: string): string {
  return `<h3 style="color:#166534;font-size:16px;margin:14px 0 4px;">${text}</h3>`;
}

function emptyLi(text: string): string {
  return `<li style="margin:6px 0;font-size:13px;color:#6b7280;">${text}</li>`;
}

/** STEP 4 + STEP 5 — newsletter HTML block (placed before the footer). */
export function buildSourceReviewHtml(result: SourceReviewResult): string {
  const removals = result.existing.filter((e) => e.recommendation === 'REMOVE');

  const newList = result.recommendedNew.length
    ? result.recommendedNew.map(newSourceHtml).join('')
    : emptyLi('אין מקורות חדשים מומלצים השבוע.');
  const removalList = removals.length
    ? removals.map(removalHtml).join('')
    : emptyLi('אין מקורות המומלצים להסרה השבוע.');
  const observeList = result.underObservation.length
    ? result.underObservation.map(observationHtml).join('')
    : emptyLi('אין מקורות במעקב השבוע.');

  const approvalAdd = result.approval.add.length
    ? result.approval.add.map((d) => `<li style="margin:3px 0;">${esc(d)}</li>`).join('')
    : '<li style="margin:3px 0;color:#6b7280;">—</li>';
  const approvalRemove = result.approval.remove.length
    ? result.approval.remove.map((id) => `<li style="margin:3px 0;">${esc(id)}</li>`).join('')
    : '<li style="margin:3px 0;color:#6b7280;">—</li>';

  return `<tr><td style="padding:18px 20px;background:#f8fafc;border-top:2px solid #14532d;">
    <h2 style="margin:0 0 4px;color:#14532d;font-size:18px;">${SECTION_TITLE}</h2>
    ${subhead('מקורות חדשים מומלצים')}
    <ul style="margin:0;padding-inline-start:20px;">${newList}</ul>
    ${subhead('מקורות המומלצים להסרה')}
    <ul style="margin:0;padding-inline-start:20px;">${removalList}</ul>
    ${subhead('מקורות במעקב')}
    <ul style="margin:0;padding-inline-start:20px;">${observeList}</ul>
    <div style="margin-top:16px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <div style="font-weight:bold;color:#92400e;font-size:14px;">APPROVAL REQUIRED</div>
      <div style="color:#92400e;font-size:12px;margin:4px 0 8px;">שינויים ברשימת המקורות לא יוחלו אוטומטית. לאישור — ערכו את data/source-approvals.json.</div>
      <div style="font-size:13px;color:#374151;">Add:</div>
      <ul style="margin:2px 0 6px;padding-inline-start:20px;font-size:13px;">${approvalAdd}</ul>
      <div style="font-size:13px;color:#374151;">Remove:</div>
      <ul style="margin:2px 0 0;padding-inline-start:20px;font-size:13px;">${approvalRemove}</ul>
    </div>
  </td></tr>`;
}
