import { config } from './config.js';
import { now } from './clock.js';
import type { AqiReport, CityAirQuality, NationalSnapshot, OfficialStatus } from './airQuality.js';
import type { ClassifiedItem, Importance } from './types.js';

const REPORT_TITLE = 'דוח שבועי – מחזור, פסולת וסביבה בישראל';

function reportDate(): string {
  return now().toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('he-IL') : 'ללא תאריך';
}

export const FALLBACK_NOTICE = 'לא נמצאו פריטים חדשים בהרצה זו, מוצג הדוח השבועי האחרון שנשמר.';
const LOW_ACTIVITY_NOTICE = 'הפעילות בתחום הייתה מצומצמת השבוע.';
const BACKGROUND_TITLE = 'רקע ועדכונים חשובים מהשבועות האחרונים';

export interface NewsletterOptions {
  fallbackNote?: boolean;
  /** Pre-rendered "Sources & recommendations to follow" section (table rows). */
  sourceReviewHtml?: string;
  sourceReviewMd?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ---------------- Editorial helpers ----------------

const IMPORTANCE: Record<Importance, { label: string; bg: string }> = {
  High: { label: 'חשיבות גבוהה', bg: '#b91c1c' },
  Medium: { label: 'חשיבות בינונית', bg: '#1d4ed8' },
  Low: { label: 'חשיבות נמוכה', bg: '#6b7280' },
};

const LEGAL_TERMS = [
  'חוק', 'תקנה', 'תקנות', 'רגולציה', 'חקיקה', 'תזכיר', 'הצעת חוק', 'תיקון',
  'רפורמה', 'דיון', 'ועדת', 'ועדה', 'החלטת ממשלה', 'כתב אישום', 'תביעה',
  'בג"ץ', 'עתירה', 'פסק דין', 'קנס', 'עיצום', 'הפרת', 'קריאה ראשונה',
  'קריאה שנייה', 'אכיפה', 'צו ',
];
const TENDER_TERMS = ['מכרז', 'מכרזים', 'קול קורא', 'הזמנה להציע'];
const POLLUTION_TERMS = ['זיהום', 'שריפה', 'דליפה', 'מפגע', 'שפך', 'בעירה'];
const ENFORCEMENT_TERMS = ['אכיפה', 'תביעה', 'כתב אישום', 'קנס', 'עיצום', 'מבצע', 'הוחרמו', 'הושמדו', 'בלתי חוקי', 'פיראטי'];
const INNOVATION_CATS = ['כלכלה מעגלית', 'חדשנות סביבתית', 'מחקרים ופיתוח'];
const WASTE_CATS = ['מחזור', 'ניהול פסולת', 'מחזור פלסטיק', 'פסולת אלקטרונית'];

function textOf(i: ClassifiedItem): string {
  return `${i.title} ${i.summary ?? ''}`;
}
function isLegal(i: ClassifiedItem): boolean {
  const t = textOf(i);
  return !TENDER_TERMS.some((k) => t.includes(k)) && LEGAL_TERMS.some((k) => t.includes(k));
}
function isEnforcementOrPollution(i: ClassifiedItem): boolean {
  const t = textOf(i);
  return POLLUTION_TERMS.some((k) => t.includes(k)) || ENFORCEMENT_TERMS.some((k) => t.includes(k));
}
function isInnovation(i: ClassifiedItem): boolean {
  return i.categories.some((c) => INNOVATION_CATS.includes(c));
}
function isWasteHighlight(i: ClassifiedItem): boolean {
  // Only 'strong' tier items (real recycling/waste content) may headline this
  // section — a generic climate/policy article must never appear here just
  // because it defaulted into a waste category.
  return i.relevanceTier === 'strong' && i.categories.some((c) => WASTE_CATS.includes(c));
}

export interface LegislationResult {
  legal: ClassifiedItem[];
  rejectedTender: number;
  rejectedNotLegal: number;
}

/** Pick legislation/regulation/enforcement items from the item set. */
export function selectLegislation(items: ClassifiedItem[]): LegislationResult {
  const legal: ClassifiedItem[] = [];
  let rejectedTender = 0;
  let rejectedNotLegal = 0;
  for (const i of items) {
    const t = textOf(i);
    if (TENDER_TERMS.some((k) => t.includes(k))) {
      rejectedTender++;
      continue;
    }
    if (LEGAL_TERMS.some((k) => t.includes(k))) legal.push(i);
    else rejectedNotLegal++;
  }
  return { legal, rejectedTender, rejectedNotLegal };
}

function legislationExplanation(i: ClassifiedItem): string {
  const t = textOf(i);
  const has = (k: string) => t.includes(k);
  if (has('חוק האריזות')) return 'עדכון בנושא חוק האריזות.';
  if (has('חוק הפיקדון')) return 'עדכון בנושא חוק הפיקדון.';
  if (
    has('כתב אישום') || has('תביעה') || has('בג"ץ') || has('עתירה') || has('פסק דין') ||
    has('קנס') || has('עיצום') || has('אכיפה') || has('בלתי חוקי') || has('לא חוקי') ||
    has('הוחרמו') || has('הושמדו') || has('פיראטי') || has('הברחת') || has('מבצע')
  ) {
    return 'הליך משפטי / אכיפה סביבתית.';
  }
  if (has('תזכיר') || has('הצעת חוק') || has('קריאה ראשונה') || has('קריאה שנייה') || has('חקיקה')) {
    return 'הליך חקיקה חדש.';
  }
  if (has('תקנות') || has('תקנה') || has('צו')) return 'עדכון תקנות / צו.';
  if (has('רפורמה')) return 'רפורמה רגולטורית.';
  if (has('ועדת') || has('ועדה') || has('דיון')) return 'דיון / ועדה בנושא רגולציה סביבתית.';
  if (has('החלטת ממשלה')) return 'החלטת ממשלה בתחום הסביבה.';
  return 'עדכון רגולטורי / משפטי בתחום הסביבה.';
}

/** One deterministic, category-driven "why this matters" sentence per item. */
function whyItMatters(i: ClassifiedItem): string {
  if (isLegal(i)) return legislationExplanation(i);
  if (i.categories.includes('פסולת אלקטרונית')) {
    return 'משפיע על הטיפול בפסולת אלקטרונית ועל עמידה בדרישות החוק בתחום.';
  }
  if (isEnforcementOrPollution(i)) {
    return 'אירוע אכיפה / זיהום שעשוי להשפיע על בריאות הציבור ועל רשויות הפיקוח.';
  }
  if (i.categories.includes('חברות סביבה ישראליות')) {
    return 'נוגע ישירות לפעילות של חברה מרכזית בתעשיית הסביבה בישראל.';
  }
  if (isInnovation(i)) {
    return 'עשוי לתרום לפתרונות טכנולוגיים או עסקיים חדשים לאתגרי המחזור והפסולת בישראל.';
  }
  if (i.relevanceTier === 'strong') {
    return 'בעל השפעה ישירה על תשתיות המחזור וניהול הפסולת בישראל.';
  }
  if (i.relevanceTier === 'secondary') {
    return 'בעל השלכות רגולטוריות, תפעוליות או עסקיות אפשריות על המגזר הסביבתי בישראל.';
  }
  return 'רקע כללי בנושאי סביבה וקיימות.';
}

// ---------------- HTML building blocks ----------------

function badge(imp: Importance): string {
  const { label, bg } = IMPORTANCE[imp];
  return `<span style="display:inline-block;background:${bg};color:#ffffff;font-size:12px;font-weight:bold;padding:3px 10px;border-radius:12px;">${label}</span>`;
}
function categoryChip(cat: string): string {
  return `<span style="display:inline-block;background:#e5e7eb;color:#374151;font-size:11px;padding:2px 8px;border-radius:10px;margin-inline-start:6px;">${esc(cat)}</span>`;
}
function metaLine(i: ClassifiedItem): string {
  return `<div style="color:#6b7280;font-size:13px;margin:6px 0;">${esc(i.source)} · ${fmtDate(i.publishedAt)}</div>`;
}
function whyLine(i: ClassifiedItem): string {
  return `<div style="color:#065f46;font-size:13px;margin-top:5px;"><b>למה זה חשוב:</b> ${esc(whyItMatters(i))}</div>`;
}

/** Large hero card for the single most important story. */
function heroCard(i: ClassifiedItem): string {
  const image = i.imageUrl
    ? `<a href="${esc(i.url)}" target="_blank"><img src="${esc(i.imageUrl)}" alt="" width="560" style="width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin-bottom:14px;" /></a>`
    : '';
  const summary = i.summary
    ? `<p style="color:#374151;font-size:15px;line-height:1.6;margin:8px 0 0;">${esc(truncate(i.summary, 220))}</p>`
    : '';
  return `<tr><td style="padding:20px 20px 8px;">
    ${image}
    ${badge(i.importance)}${i.categories.map(categoryChip).join('')}
    <h2 style="margin:10px 0 0;font-size:22px;line-height:1.35;">
      <a href="${esc(i.url)}" target="_blank" style="color:#14532d;text-decoration:none;">${esc(i.title)}</a>
    </h2>
    ${metaLine(i)}
    ${summary}
    ${whyLine(i)}
  </td></tr>`;
}

/** Compact card with thumbnail + text, used across sections 4-7. */
function storyCard(i: ClassifiedItem): string {
  const thumb = i.imageUrl
    ? `<td width="120" valign="top" style="padding-left:12px;">
         <a href="${esc(i.url)}" target="_blank"><img src="${esc(i.imageUrl)}" alt="" width="120" style="width:120px;height:84px;border-radius:6px;display:block;border:1px solid #eee;" /></a>
       </td>`
    : '';
  const summary = i.summary
    ? `<div style="color:#4b5563;font-size:13px;line-height:1.5;margin-top:5px;">${esc(truncate(i.summary, 130))}</div>`
    : '';
  return `<tr><td style="padding:14px 20px;border-top:1px solid #eef0f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${thumb}
      <td valign="top">
        ${badge(i.importance)}${i.categories.map(categoryChip).join('')}
        <div style="margin:7px 0 0;font-size:16px;font-weight:bold;line-height:1.35;">
          <a href="${esc(i.url)}" target="_blank" style="color:#166534;text-decoration:none;">${esc(i.title)}</a>
        </div>
        ${metaLine(i)}
        ${summary}
        ${whyLine(i)}
      </td>
    </tr></table>
  </td></tr>`;
}

/** Plain link list for leftover weekly items not claimed by any section. */
function linksSection(items: ClassifiedItem[]): string {
  if (!items.length) return '';
  const lis = items
    .map(
      (i) =>
        `<li style="margin:8px 0;font-size:14px;">
          <a href="${esc(i.url)}" target="_blank" style="color:#15803d;text-decoration:none;">${esc(i.title)}</a>
          <span style="color:#9ca3af;"> — ${esc(i.source)} · ${fmtDate(i.publishedAt)}</span>
        </li>`,
    )
    .join('');
  return `<tr><td style="padding:18px 20px 4px;">
    <h3 style="color:#166534;font-size:17px;margin:0 0 6px;">עוד עדכונים השבוע</h3>
    <ul style="margin:0;padding-inline-start:20px;">${lis}</ul>
  </td></tr>`;
}

function sectionHeader(title: string): string {
  return `<tr><td style="padding:18px 20px 0;"><h3 style="color:#166534;font-size:18px;margin:0;border-top:2px solid #ecfdf5;padding-top:16px;">${esc(title)}</h3></td></tr>`;
}

/** A titled section of story cards — omitted entirely when empty (item 6). */
function cardsSection(title: string, items: ClassifiedItem[]): string {
  if (!items.length) return '';
  return `${sectionHeader(title)}${items.map(storyCard).join('')}`;
}

// ---------------- Section 1: מצב הסביבה בישראל השבוע ----------------

const STATUS_TITLE = 'מצב הסביבה בישראל השבוע';
const AQI_UNAVAILABLE = 'נתוני איכות אוויר אינם זמינים כרגע';

const STATUS_COLOR: Record<OfficialStatus, { c: string; bg: string }> = {
  טובה: { c: '#16a34a', bg: '#dcfce7' },
  בינונית: { c: '#ca8a04', bg: '#fef9c3' },
  נמוכה: { c: '#ea580c', bg: '#ffedd5' },
  'נמוכה מאוד': { c: '#dc2626', bg: '#fee2e2' },
};
const NEUTRAL_COLOR = { c: '#6b7280', bg: '#f3f4f6' };

function statusColor(status: OfficialStatus | null): { c: string; bg: string } {
  return status ? STATUS_COLOR[status] : NEUTRAL_COLOR;
}

interface Snapshot {
  pollution: string;
  waste: string;
  enforcement: string;
}

/** Non-AQI status bullets. AQI itself is rendered exactly once, separately. */
function buildSnapshot(items: ClassifiedItem[]): Snapshot {
  const pollution = items.filter((i) => POLLUTION_TERMS.some((k) => textOf(i).includes(k)));
  const enforcement = items.filter((i) => ENFORCEMENT_TERMS.some((k) => textOf(i).includes(k)));
  const waste = items.filter(isWasteHighlight);

  return {
    pollution: pollution.length
      ? `${pollution.length} אירועי זיהום/מפגע צוינו, בהם: ${truncate(pollution[0].title, 70)}`
      : 'לא דווחו אירועי זיהום מרכזיים השבוע',
    waste: waste.length
      ? `מחזור ופסולת: ${truncate(waste[0].title, 70)}`
      : 'אין דגשי מחזור/פסולת בולטים השבוע',
    enforcement: enforcement.length
      ? `${enforcement.length} פעולות אכיפה/תביעה, בהן: ${truncate(enforcement[0].title, 70)}`
      : 'לא צוינו פעולות אכיפה מרכזיות השבוע',
  };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "תמונת מצב ארצית" — national snapshot card. No simple average is shown. */
function aqiNationalCard(national: NationalSnapshot | null): string {
  if (!national) {
    return `<div style="background:#f3f4f6;border-radius:8px;padding:8px;text-align:center;color:#6b7280;font-size:12px;margin-bottom:6px;">תמונת מצב ארצית אינה זמינה כרגע</div>`;
  }
  const { c, bg } = statusColor(national.generalStatus);
  const worst = national.worstStation;
  const counts = Object.entries(national.statusCounts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${esc(status)}: ${n}`)
    .join(' · ');
  return `<div style="background:${bg};border:1px solid ${c};border-radius:8px;padding:8px;margin-bottom:6px;">
    <div style="font-size:12px;color:#374151;font-weight:bold;">תמונת מצב ארצית</div>
    <div style="font-size:13px;color:${c};font-weight:bold;margin:2px 0;">מצב כללי: ${esc(national.generalStatus ?? 'לא ידוע')}</div>
    <div style="font-size:11px;color:#6b7280;">${national.activeStationsWithData} תחנות פעילות עם נתונים · ${counts || 'אין פילוח סטטוסים'}</div>
    ${worst ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">התחנה עם המצב הגרוע ביותר כרגע: ${esc(worst.stationName)}${worst.city ? ` (${esc(worst.city)})` : ''}${worst.dominantPollutant ? ` — מזהם דומיננטי: ${esc(worst.dominantPollutant)}` : ''}</div>` : ''}
  </div>`;
}

function aqiCityCard(ci: CityAirQuality): string {
  const { c, bg } = statusColor(ci.status);
  const value = ci.index != null ? String(ci.index) : ci.dominantPollutant ? esc(ci.dominantPollutant) : '—';
  const label = ci.status ?? (ci.degraded ? 'מדד רשמי לא זמין' : 'לא ידוע');
  return `<td width="20%" valign="top" style="padding:3px;">
    <div style="background:${bg};border:1px solid ${c};border-radius:8px;padding:7px 3px;text-align:center;">
      <div style="font-size:11px;color:#374151;line-height:1.2;">${esc(ci.city)}</div>
      <div style="font-size:18px;font-weight:bold;color:${c};line-height:1.2;">${value}</div>
      <div style="font-size:10px;color:${c};">${esc(label)}</div>
      <div style="font-size:9px;color:#9ca3af;margin-top:2px;">${esc(ci.stationName)}</div>
    </div>
  </td>`;
}

/** Compact RTL air-quality card — city cards are only shown when data exists (item 8). */
function aqiSectionHtml(aqi: AqiReport): string {
  if (!aqi.available) {
    return `<div style="background:#f3f4f6;border-radius:8px;padding:12px;text-align:center;color:#6b7280;font-size:14px;">${AQI_UNAVAILABLE}</div>`;
  }
  const nationalCard = aqiNationalCard(aqi.national);
  const cityCells = aqi.cities.map(aqiCityCard).join('');
  const cityRow = cityCells
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cityCells}</tr></table>`
    : '';
  return `${nationalCard}${cityRow}
    <div style="font-size:10px;color:#9ca3af;margin-top:6px;">
      עדכון אחרון: ${fmtTime(aqi.measuredAt)} · מקור:
      <a href="${esc(aqi.sourceUrl)}" target="_blank" style="color:#2563eb;">${esc(aqi.source)}</a>
    </div>
    <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${esc(aqi.disclaimer)}</div>`;
}

/** Compact, mobile-friendly environmental status section (first in newsletter). */
function statusSectionHtml(items: ClassifiedItem[], aqi: AqiReport): string {
  // The AQI message (available or unavailable) is rendered exactly once here.
  const s = buildSnapshot(items);
  const bullets = [s.pollution, s.waste, s.enforcement]
    .map((b) => `<li style="margin:4px 0;font-size:13px;color:#374151;line-height:1.5;">${esc(b)}</li>`)
    .join('');
  return `<tr><td style="padding:16px 20px;background:#ecfdf5;border-bottom:2px solid #14532d;">
    <h2 style="margin:0 0 10px;color:#14532d;font-size:18px;">${STATUS_TITLE}</h2>
    ${aqiSectionHtml(aqi)}
    <ul style="margin:10px 0 0;padding-inline-start:18px;">${bullets}</ul>
  </td></tr>`;
}

function aqiSectionMarkdown(aqi: AqiReport): string {
  if (!aqi.available) return AQI_UNAVAILABLE;
  const lines: string[] = [];
  if (aqi.national) {
    const n = aqi.national;
    const counts = Object.entries(n.statusCounts)
      .filter(([, c]) => c > 0)
      .map(([status, c]) => `${status}: ${c}`)
      .join(', ');
    lines.push(`**תמונת מצב ארצית:** מצב כללי — ${n.generalStatus ?? 'לא ידוע'} (${n.activeStationsWithData} תחנות פעילות; ${counts || 'אין פילוח'})`);
    if (n.worstStation) {
      lines.push(
        `התחנה עם המצב הגרוע ביותר כרגע: ${n.worstStation.stationName}${n.worstStation.city ? ` (${n.worstStation.city})` : ''}${n.worstStation.dominantPollutant ? ` — מזהם דומיננטי: ${n.worstStation.dominantPollutant}` : ''}`,
      );
    }
  }
  for (const c of aqi.cities) {
    const value = c.index != null ? `מדד ${c.index}` : 'מדד רשמי לא זמין';
    lines.push(`- **${c.city}** (תחנת ${c.stationName}): ${c.status ?? value}${c.dominantPollutant ? ` — ${c.dominantPollutant}` : ''}`);
  }
  lines.push(`_עדכון אחרון: ${fmtTime(aqi.measuredAt)} · מקור: [${aqi.source}](${aqi.sourceUrl})_`);
  lines.push(`_${aqi.disclaimer}_`);
  return lines.join('\n');
}

export function buildStatusMarkdown(items: ClassifiedItem[], aqi: AqiReport): string {
  const s = buildSnapshot(items);
  return `## ${STATUS_TITLE}

${aqiSectionMarkdown(aqi)}

**תמונת מצב:**
- ${s.pollution}
- ${s.waste}
- ${s.enforcement}
`;
}

// ---------------- Section 2: חקיקה ורגולציה השבוע ----------------

const LEGISLATION_TITLE = 'חקיקה ורגולציה השבוע';
const NO_LEGISLATION = 'לא אותרו השבוע עדכוני חקיקה או רגולציה משמעותיים בתחום.';

function legislationSectionHtml(legal: ClassifiedItem[]): string {
  const body = legal.length
    ? legal
        .slice(0, 6)
        .map(
          (i) => `<div style="margin:8px 0;padding-bottom:8px;border-bottom:1px dashed #e5e7eb;">
        <div style="font-size:11px;color:#6b7280;">${fmtDate(i.publishedAt)} · ${esc(i.source)}</div>
        <div style="font-size:15px;font-weight:bold;line-height:1.35;margin:2px 0;">
          <a href="${esc(i.url)}" target="_blank" style="color:#166534;text-decoration:none;">${esc(i.title)}</a>
        </div>
        <div style="font-size:13px;color:#4b5563;">${esc(legislationExplanation(i))}</div>
      </div>`,
        )
        .join('')
    : `<div style="color:#6b7280;font-size:14px;">${NO_LEGISLATION}</div>`;
  return `<tr><td style="padding:16px 20px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
    <h2 style="margin:0 0 8px;color:#14532d;font-size:18px;">${LEGISLATION_TITLE}</h2>
    ${body}
  </td></tr>`;
}

export function buildLegislationMarkdown(legal: ClassifiedItem[]): string {
  if (!legal.length) return `## ${LEGISLATION_TITLE}\n\n${NO_LEGISLATION}\n`;
  const lines = legal
    .map((i) => `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source}\n  ${legislationExplanation(i)}`)
    .join('\n');
  return `## ${LEGISLATION_TITLE}\n\n${lines}\n`;
}

// ---------------- Section 3: תקציר מנהלים ----------------

const EXEC_SUMMARY_TITLE = 'תקציר מנהלים';

/** Distinct category names actually present this week (used, not invented). */
function topicsPresent(items: ClassifiedItem[]): string[] {
  const set = new Set<string>();
  for (const i of items) for (const c of i.categories) set.add(c);
  return [...set];
}

function executiveSummaryText(weekly: ClassifiedItem[]): { lowActivity: boolean; text: string } {
  if (!weekly.length) {
    return {
      lowActivity: true,
      text: `לא נמצאו פריטים טריים ורלוונטיים מהמקורות שנסרקו השבוע (${config.freshnessDays} הימים האחרונים). ${LOW_ACTIVITY_NOTICE}`,
    };
  }
  const topics = topicsPresent(weekly);
  const counts = { High: 0, Medium: 0, Low: 0 } as Record<Importance, number>;
  for (const i of weekly) counts[i.importance]++;

  if (weekly.length < config.minWeeklyItems) {
    return {
      lowActivity: true,
      text: `${LOW_ACTIVITY_NOTICE} נמצאו ${weekly.length} פריטים רלוונטיים בלבד ב-${config.freshnessDays} הימים האחרונים. הנושאים שכן עלו השבוע: ${topics.join(', ')}. לתמונה רחבה יותר ראו את סעיף "${BACKGROUND_TITLE}" בהמשך הדוח.`,
    };
  }
  return {
    lowActivity: false,
    text: `השבוע נכללו ${weekly.length} פריטים רלוונטיים וטריים (${config.freshnessDays} הימים האחרונים): חשיבות גבוהה ${counts.High}, בינונית ${counts.Medium}, נמוכה ${counts.Low}. הנושאים הבולטים: ${topics.slice(0, 6).join(', ')}.`,
  };
}

function executiveSummaryHtml(weekly: ClassifiedItem[]): string {
  const { lowActivity, text } = executiveSummaryText(weekly);
  const warn = lowActivity
    ? `<p style="margin:8px 0 0;color:#b45309;font-weight:bold;">${esc(LOW_ACTIVITY_NOTICE)}</p>`
    : '';
  return `<tr><td style="padding:18px 20px;background:#f0fdf4;border-top:1px solid #dcfce7;">
    <h2 style="margin:0 0 8px;color:#14532d;font-size:18px;">${EXEC_SUMMARY_TITLE}</h2>
    <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">${esc(text)}</p>
    ${warn}
  </td></tr>`;
}

function executiveSummaryMarkdown(weekly: ClassifiedItem[]): string {
  const { text } = executiveSummaryText(weekly);
  return `## ${EXEC_SUMMARY_TITLE}\n\n${text}\n`;
}

// ---------------- Section 4: שלוש ההתפתחויות החשובות ביותר ----------------

const TOP3_TITLE = 'שלוש ההתפתחויות החשובות ביותר';

function top3Markdown(items: ClassifiedItem[]): string {
  if (!items.length) return '';
  const lines = items
    .map(
      (i) =>
        `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source} _(${i.importance} · ${i.categories.join(', ')})_\n  ${i.summary ? truncate(i.summary, 220) + '\n  ' : ''}למה זה חשוב: ${whyItMatters(i)}`,
    )
    .join('\n');
  return `## ${TOP3_TITLE}\n\n${lines}\n`;
}

// ---------------- Sections 5-7 markdown ----------------

function itemsMarkdownBlock(title: string, items: ClassifiedItem[]): string {
  if (!items.length) return '';
  const lines = items
    .map(
      (i) =>
        `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source} _(${i.importance})_\n  ${i.summary ? truncate(i.summary, 200) + ' — ' : ''}${whyItMatters(i)}`,
    )
    .join('\n');
  return `## ${title}\n\n${lines}\n`;
}

// ---------------- Section 8: רקע ועדכונים חשובים מהשבועות האחרונים ----------------

function backgroundSectionHtml(items: ClassifiedItem[]): string {
  if (!items.length) return '';
  const cards = items
    .map(
      (i) => `<div style="margin:8px 0;padding-bottom:8px;border-bottom:1px dashed #e5e7eb;">
        <div style="font-size:11px;color:#6b7280;">${fmtDate(i.publishedAt)} · ${esc(i.source)}</div>
        <div style="font-size:15px;font-weight:bold;line-height:1.35;margin:2px 0;">
          <a href="${esc(i.url)}" target="_blank" style="color:#166534;text-decoration:none;">${esc(i.title)}</a>
        </div>
        ${badge(i.importance)}${i.categories.map(categoryChip).join('')}
      </div>`,
    )
    .join('');
  return `<tr><td style="padding:18px 20px;background:#fffbeb;border-top:2px solid #fde68a;">
    <h2 style="margin:0 0 4px;color:#92400e;font-size:18px;">${BACKGROUND_TITLE}</h2>
    <p style="margin:0 0 8px;color:#92400e;font-size:13px;">עדכונים ותיקים יותר (עד 30 יום אחורה) המסופקים כרקע — אינם חלק מהדיווח השבועי הנוכחי.</p>
    ${cards}
  </td></tr>`;
}

function backgroundSectionMarkdown(items: ClassifiedItem[]): string {
  if (!items.length) return '';
  const lines = items
    .map((i) => `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source} _(${i.importance})_`)
    .join('\n');
  return `## ${BACKGROUND_TITLE}\n\n_עדכונים ותיקים יותר (עד 30 יום אחורה), מוצגים כרקע בלבד — אינם חלק מהדיווח השבועי._\n\n${lines}\n`;
}

// ---------------- Assembly ----------------

export interface NewsletterContent {
  markdown: string;
  html: string;
}

/**
 * Curate items into the sections 4-7 buckets with cross-section de-duplication
 * (item 6 — no article appears twice as a duplicate card). Legislation-section
 * items are excluded from being re-picked here too.
 */
function curateSections(
  weekly: ClassifiedItem[],
  legal: ClassifiedItem[],
): { top3: ClassifiedItem[]; waste: ClassifiedItem[]; enforcement: ClassifiedItem[]; innovation: ClassifiedItem[]; rest: ClassifiedItem[] } {
  const used = new Set<string>(legal.map((i) => i.url));
  const take = (pool: ClassifiedItem[], n: number, pred: (i: ClassifiedItem) => boolean): ClassifiedItem[] => {
    const out: ClassifiedItem[] = [];
    for (const i of pool) {
      if (used.has(i.url) || !pred(i)) continue;
      out.push(i);
      used.add(i.url);
      if (out.length >= n) break;
    }
    return out;
  };

  const top3 = take(weekly, 3, () => true);
  const waste = take(weekly, 6, isWasteHighlight);
  const enforcement = take(weekly, 6, isEnforcementOrPollution);
  const innovation = take(weekly, 6, isInnovation);
  const rest = weekly.filter((i) => !used.has(i.url));

  return { top3, waste, enforcement, innovation, rest };
}

/** Build the deterministic Hebrew Markdown report (sections 3-8). */
export function buildNewsletterMarkdown(
  weekly: ClassifiedItem[],
  fallbackItems: ClassifiedItem[],
  legal: ClassifiedItem[],
): string {
  const { top3, waste, enforcement, innovation, rest } = curateSections(weekly, legal);
  const parts = [
    executiveSummaryMarkdown(weekly),
    top3Markdown(top3),
    itemsMarkdownBlock('מחזור, פסולת ותעשייה', waste),
    itemsMarkdownBlock('אכיפה ואירועי זיהום', enforcement),
    itemsMarkdownBlock('חדשנות וכלכלה מעגלית', innovation),
    rest.length ? itemsMarkdownBlock('עוד עדכונים השבוע', rest) : '',
    backgroundSectionMarkdown(fallbackItems),
  ];
  return parts.filter(Boolean).join('\n');
}

/** Build the visual Hebrew newsletter (RTL, table-based, inline styles for Gmail). */
export function buildNewsletterHtml(
  weekly: ClassifiedItem[],
  fallbackItems: ClassifiedItem[],
  aqi: AqiReport,
  legal: ClassifiedItem[],
  opts: NewsletterOptions = {},
): string {
  const { top3, waste, enforcement, innovation, rest } = curateSections(weekly, legal);

  const fallbackBanner = opts.fallbackNote
    ? `<tr><td style="padding:10px 20px;background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13px;">${esc(FALLBACK_NOTICE)}</td></tr>`
    : '';
  const emptyHtml = weekly.length
    ? ''
    : `<tr><td style="padding:24px 20px;color:#374151;">לא נמצאו פריטים רלוונטיים וטריים השבוע.</td></tr>`;

  const hero = top3[0];
  const top3Header = top3.length ? sectionHeader(TOP3_TITLE) : '';
  const heroHtml = hero ? heroCard(hero) : '';
  const top3RestHtml = top3.slice(1).map(storyCard).join('');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${REPORT_TITLE}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;">
  <tr><td align="center" style="padding:16px 10px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl"
           style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Arial,sans-serif;">
      <tr><td style="background:#14532d;padding:20px;">
        <div style="color:#ffffff;font-size:20px;font-weight:bold;">${REPORT_TITLE}</div>
        <div style="color:#bbf7d0;font-size:13px;margin-top:4px;">${reportDate()} · חלון טריות: ${config.freshnessDays} ימים אחרונים</div>
      </td></tr>
      ${fallbackBanner}
      ${statusSectionHtml(weekly, aqi)}
      ${legislationSectionHtml(legal)}
      ${executiveSummaryHtml(weekly)}
      ${emptyHtml}
      ${top3Header}
      ${heroHtml}
      ${top3RestHtml}
      ${cardsSection('מחזור, פסולת ותעשייה', waste)}
      ${cardsSection('אכיפה ואירועי זיהום', enforcement)}
      ${cardsSection('חדשנות וכלכלה מעגלית', innovation)}
      ${linksSection(rest)}
      ${backgroundSectionHtml(fallbackItems)}
      ${opts.sourceReviewHtml ?? ''}
      <tr><td style="padding:16px 20px;background:#f9fafb;border-top:1px solid #eee;color:#9ca3af;font-size:12px;line-height:1.5;">
        הדוח הופק אוטומטית על ידי סוכן AI לניטור מחזור, פסולת וסביבה בישראל.
        התמונות מוצגות מקישור המקור (לא מצורפות). אם תמונה אינה נטענת, ניתן להציג תמונות במייל.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export { REPORT_TITLE };
