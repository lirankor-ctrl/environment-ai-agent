import OpenAI from 'openai';
import { config } from './config.js';
import { log } from './logger.js';
import type { AqiBand, AqiReport } from './airQuality.js';
import type { ClassifiedItem, Importance } from './types.js';

const REPORT_TITLE = 'דוח שבועי – מחזור, פסולת וסביבה בישראל';

function reportDate(): string {
  return new Date().toLocaleDateString('he-IL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('he-IL') : 'ללא תאריך';
}

/** A single report line — always includes the publication date + source link. */
function itemLine(i: ClassifiedItem): string {
  return `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source} _(${i.importance})_`;
}

/** Best N items (cap the report at 12 when more are found). */
function topItems(items: ClassifiedItem[], n = 12): ClassifiedItem[] {
  return items.slice(0, n);
}

const LOW_COUNT_NOTICE = 'נמצאו השבוע מעט פריטים רלוונטיים בלבד.';
const LEGISLATION_TITLE = 'חקיקה ורגולציה השבוע';
const NO_LEGISLATION = 'לא אותרו השבוע עדכוני חקיקה או רגולציה משמעותיים בתחום.';
export const FALLBACK_NOTICE = 'לא נמצאו פריטים חדשים בהרצה זו, מוצג הדוח השבועי האחרון שנשמר.';

export interface NewsletterOptions {
  fallbackNote?: boolean;
}

function itemsForPrompt(items: ClassifiedItem[]): string {
  return JSON.stringify(
    items.map((i) => ({
      title: i.title,
      url: i.url,
      source: i.source,
      publishedAt: i.publishedAt ?? null,
      importance: i.importance,
      categories: i.categories,
      summary: i.summary ?? '',
    })),
    null,
    2,
  );
}

/** Deterministic offline report (no OpenAI key) — short, focused, dated. */
export function buildFallbackReport(items: ClassifiedItem[]): string {
  const top = topItems(items, 12);
  const companies = items.filter((i) => i.categories.includes('חברות סביבה ישראליות'));
  const lowNote = items.length < 5 ? `\n> ${LOW_COUNT_NOTICE}\n` : '';

  // Rough "trends" = most common categories this week.
  const counts = new Map<string, number>();
  for (const i of items) for (const c of i.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const trends = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, n]) => `- ${c}: ${n} פריטים`)
    .join('\n');

  return `# ${REPORT_TITLE}
_${reportDate()} · חלון טריות: ${config.freshnessDays} ימים אחרונים_

## תקציר מנהלים
השבוע נכללו ${items.length} פריטים טריים ורלוונטיים (פורסמו ב-${config.freshnessDays} הימים האחרונים) מתוך המקורות שנסרקו. להלן הסיפורים החשובים, מגמות בתעשייה, חברות שהוזכרו ונושאים מומלצים למעקב.
${lowNote}
## הסיפורים החשובים השבוע
${top.length ? top.map(itemLine).join('\n') : '- אין פריטים טריים השבוע.'}

## מגמות בתעשייה
${trends || '- אין מספיק נתונים לזיהוי מגמות השבוע.'}

## חברות שהוזכרו
${companies.length ? companies.map(itemLine).join('\n') : '- לא הוזכרו חברות ספציפיות השבוע.'}

## נושאים מומלצים למעקב
- חדשנות וטכנולוגיות חדשות בתחום המחזור והפסולת.
- התקדמות מיזמים ופרויקטים סביבתיים בישראל.
- מחקרים חדשים בתחום הכלכלה המעגלית והקיימות.
`;
}

const SYSTEM_PROMPT = `אתה אנליסט סביבתי ישראלי. תפקידך לכתוב דוח שבועי קצר, ממוקד ומעשי בעברית על מחזור, ניהול פסולת, כלכלה מעגלית, קיימות, חדשנות סביבתית וחברות סביבה ישראליות.
כללים מחייבים:
- כתוב בעברית בלבד, בסגנון תמציתי וברור.
- הסתמך אך ורק על הפריטים שיסופקו. אל תמציא עובדות, מספרים, חברות או קישורים.
- כל הפריטים שסופקו כבר אומתו כטריים (פורסמו לאחרונה). לכל פריט שאתה מזכיר חובה לציין את תאריך הפרסום ולצרף קישור Markdown למקור.
- שמור על המבנה המבוקש בדיוק. אל תוסיף סעיפים.
- הפרד בבירור בין עדכוני חקיקה/רגולציה/אכיפה לבין חדשות כלליות: פריטים בעלי אופי חקיקתי או רגולטורי מטופלים בסעיף ייעודי נפרד ("${LEGISLATION_TITLE}") שמתווסף אוטומטית — אל תיצור אותו בעצמך, אך כשאתה מזכיר עדכון רגולטורי ב"סיפורים החשובים" סמן אותו בתחילת השורה במילה "רגולציה — ".
- אם אין פריטים לסעיף מסוים, ציין "אין עדכונים השבוע".`;

function userPrompt(items: ClassifiedItem[], legalTitles: string[]): string {
  return `כתוב דוח שבועי קצר לפי המבנה הבא בדיוק (כותרות Markdown):

# ${REPORT_TITLE}
(תאריך הפקה: ${reportDate()})

## תקציר מנהלים
## הסיפורים החשובים השבוע
## מגמות בתעשייה
## חברות שהוזכרו
## נושאים מומלצים למעקב

הנחיות:
- "הסיפורים החשובים השבוע": עד 12 הפריטים הטובים ביותר, כל אחד בשורה עם **תאריך הפרסום**, כותרת מקושרת למקור, ושם המקור.
- אם סופקו פחות מ-5 פריטים, הוסף בתחילת "תקציר מנהלים" את המשפט המדויק: "${LOW_COUNT_NOTICE}"
- "מגמות בתעשייה": 3-5 משפטים על המגמות הבולטות מתוך הפריטים בלבד.
- "חברות שהוזכרו": רשימת חברות/גופים ישראליים שהוזכרו, עם קישור לפריט הרלוונטי.
- "נושאים מומלצים למעקב": 3-5 נקודות.

פריטים בעלי אופי חקיקתי/רגולטורי (כבר מוצגים בסעיף ייעודי נפרד — סמן אותם כ"רגולציה — " אם תזכיר אותם):
${legalTitles.length ? legalTitles.map((t) => `- ${t}`).join('\n') : '- אין'}

הפריטים הטריים שנאספו השבוע (JSON):
${itemsForPrompt(items)}`;
}

/** Generate the Hebrew report markdown (OpenAI, with offline fallback). */
export async function generateReportMarkdown(items: ClassifiedItem[]): Promise<string> {
  if (!items.length) {
    return `# ${REPORT_TITLE}\n_${reportDate()}_\n\n## תקציר מנהלים\nלא נמצאו פריטים טריים (מ-${config.freshnessDays} הימים האחרונים) מהמקורות שנסרקו השבוע.\n`;
  }

  if (!config.openai.apiKey) {
    log.warn('OPENAI_API_KEY missing — generating a deterministic fallback report.');
    return buildFallbackReport(items);
  }

  try {
    const client = new OpenAI({ apiKey: config.openai.apiKey });
    log.info(`Calling OpenAI (${config.openai.model}) to write the report…`);
    const legalTitles = selectLegislation(items).legal.map((i) => i.title);
    const completion = await client.chat.completions.create({
      model: config.openai.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt(topItems(items, 12), legalTitles) },
      ],
    });
    const md = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!md) throw new Error('Empty response from OpenAI');
    return md;
  } catch (err) {
    log.error(`OpenAI failed (${(err as Error).message}) — using fallback report.`);
    return buildFallbackReport(items);
  }
}

// ---------------- Visual HTML newsletter (Gmail-friendly) ----------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const IMPORTANCE: Record<Importance, { label: string; bg: string }> = {
  High: { label: 'חשיבות גבוהה', bg: '#b91c1c' },
  Medium: { label: 'חשיבות בינונית', bg: '#1d4ed8' },
  Low: { label: 'חשיבות נמוכה', bg: '#6b7280' },
};

function badge(imp: Importance): string {
  const { label, bg } = IMPORTANCE[imp];
  return `<span style="display:inline-block;background:${bg};color:#ffffff;font-size:12px;font-weight:bold;padding:3px 10px;border-radius:12px;">${label}</span>`;
}

function meta(i: ClassifiedItem): string {
  return `<div style="color:#6b7280;font-size:13px;margin:6px 0;">${esc(i.source)} · ${fmtDate(i.publishedAt)}</div>`;
}

/** Large hero card for the most important story. */
function heroCard(i: ClassifiedItem): string {
  const image = i.imageUrl
    ? `<a href="${esc(i.url)}" target="_blank"><img src="${esc(i.imageUrl)}" alt="" width="560" style="width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin-bottom:14px;" /></a>`
    : '';
  const summary = i.summary
    ? `<p style="color:#374151;font-size:15px;line-height:1.6;margin:8px 0 0;">${esc(truncate(i.summary, 220))}</p>`
    : '';
  return `<tr><td style="padding:20px 20px 8px;">
    ${image}
    ${badge(i.importance)}
    <h2 style="margin:10px 0 0;font-size:22px;line-height:1.35;">
      <a href="${esc(i.url)}" target="_blank" style="color:#14532d;text-decoration:none;">${esc(i.title)}</a>
    </h2>
    ${meta(i)}
    ${summary}
  </td></tr>`;
}

/** Compact card with thumbnail (on the right in RTL) + text. */
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
        ${badge(i.importance)}
        <div style="margin:7px 0 0;font-size:16px;font-weight:bold;line-height:1.35;">
          <a href="${esc(i.url)}" target="_blank" style="color:#166534;text-decoration:none;">${esc(i.title)}</a>
        </div>
        ${meta(i)}
        ${summary}
      </td>
    </tr></table>
  </td></tr>`;
}

/** Plain link list for the remaining items. */
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

/** Short weekly summary block. */
function summarySection(items: ClassifiedItem[]): string {
  const counts = { High: 0, Medium: 0, Low: 0 } as Record<Importance, number>;
  for (const i of items) counts[i.importance]++;
  const cat = new Map<string, number>();
  for (const i of items) for (const c of i.categories) cat.set(c, (cat.get(c) ?? 0) + 1);
  const topCats = [...cat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c).join(', ');
  const lowNote =
    items.length < 5
      ? `<p style="margin:8px 0 0;color:#b45309;font-weight:bold;">${LOW_COUNT_NOTICE}</p>`
      : '';
  return `<tr><td style="padding:18px 20px;background:#f0fdf4;border-top:1px solid #dcfce7;">
    <h3 style="color:#166534;font-size:17px;margin:0 0 6px;">סיכום שבועי</h3>
    <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
      השבוע נכללו <b>${items.length}</b> פריטים רלוונטיים וטריים (${config.freshnessDays} ימים אחרונים):
      חשיבות גבוהה ${counts.High}, בינונית ${counts.Medium}, נמוכה ${counts.Low}.
      ${topCats ? `נושאים בולטים: ${esc(topCats)}.` : ''}
    </p>
    ${lowNote}
  </td></tr>`;
}

// ---------------- Environmental status summary (AQI + snapshot) ----------------

const BAND_COLOR: Record<AqiBand, { c: string; bg: string }> = {
  good: { c: '#16a34a', bg: '#dcfce7' },
  moderate: { c: '#ca8a04', bg: '#fef9c3' },
  usg: { c: '#ea580c', bg: '#ffedd5' },
  unhealthy: { c: '#dc2626', bg: '#fee2e2' },
};

const STATUS_TITLE = 'מצב הסביבה בישראל השבוע';
const AQI_UNAVAILABLE = 'נתוני איכות אוויר אינם זמינים כרגע';

interface Snapshot {
  air: string;
  pollution: string;
  waste: string;
  enforcement: string;
}

function buildSnapshot(items: ClassifiedItem[], aqi?: AqiReport): Snapshot {
  const txt = (i: ClassifiedItem) => `${i.title} ${i.summary ?? ''}`;
  const has = (s: string, arr: string[]) => arr.some((k) => s.includes(k));
  const POLLUTION = ['זיהום', 'שריפה', 'דליפה', 'מפגע', 'שפך', 'בעירה'];
  const ENFORCE = ['אכיפה', 'תביעה', 'כתב אישום', 'קנס', 'עיצום', 'מבצע', 'הוחרמו', 'הושמדו', 'בלתי חוקי', 'פיראטי'];
  const WASTE_CATS = ['מחזור', 'ניהול פסולת', 'מחזור פלסטיק', 'פסולת אלקטרונית'];

  const pollution = items.filter((i) => has(txt(i), POLLUTION));
  const enforcement = items.filter((i) => has(txt(i), ENFORCE));
  const waste = items.filter((i) => i.categories.some((c) => WASTE_CATS.includes(c)));

  return {
    air:
      aqi?.available && aqi.national
        ? `מגמת איכות האוויר השבוע: ${aqi.national.status} (AQI ${aqi.national.aqi})`
        : AQI_UNAVAILABLE,
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

function aqiCardCell(name: string, aqi: number, band: AqiBand): string {
  const { c, bg } = BAND_COLOR[band];
  return `<td width="25%" valign="top" style="padding:3px;">
    <div style="background:${bg};border:1px solid ${c};border-radius:8px;padding:7px 3px;text-align:center;">
      <div style="font-size:11px;color:#374151;line-height:1.2;">${esc(name)}</div>
      <div style="font-size:20px;font-weight:bold;color:${c};line-height:1.2;">${aqi}</div>
      <div style="font-size:10px;color:${c};">${esc(statusHeLabel(band))}</div>
    </div>
  </td>`;
}

const STATUS_HE_LABEL: Record<AqiBand, string> = {
  good: 'טובה',
  moderate: 'בינונית',
  usg: 'בעייתית לרגישים',
  unhealthy: 'לא בריאה',
};
function statusHeLabel(band: AqiBand): string {
  return STATUS_HE_LABEL[band];
}

function aqiCardsHtml(aqi: AqiReport): string {
  const nat = aqi.national;
  const banner = nat
    ? (() => {
        const { c, bg } = BAND_COLOR[nat.band];
        return `<div style="background:${bg};border-radius:8px;padding:8px;text-align:center;margin-bottom:6px;">
          <span style="font-size:13px;color:#374151;">ממוצע ארצי (מדגם ערים): </span>
          <span style="font-size:19px;font-weight:bold;color:${c};">${nat.aqi}</span>
          <span style="color:${c};font-weight:bold;"> · ${esc(nat.status)}</span>
        </div>`;
      })()
    : '';
  const cells = aqi.cities.map((ci) => aqiCardCell(ci.name, ci.aqi, ci.band)).join('');
  const row = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
  return banner + row;
}

/** Compact, mobile-friendly environmental status section (first in newsletter). */
function statusSectionHtml(items: ClassifiedItem[], aqi?: AqiReport): string {
  const aqiBlock =
    aqi?.available
      ? aqiCardsHtml(aqi)
      : `<div style="background:#f3f4f6;border-radius:8px;padding:12px;text-align:center;color:#6b7280;font-size:14px;">${AQI_UNAVAILABLE}</div>`;
  const s = buildSnapshot(items, aqi);
  const bullets = [s.air, s.pollution, s.waste, s.enforcement]
    .map((b) => `<li style="margin:4px 0;font-size:13px;color:#374151;line-height:1.5;">${esc(b)}</li>`)
    .join('');
  return `<tr><td style="padding:16px 20px;background:#ecfdf5;border-bottom:2px solid #14532d;">
    <h2 style="margin:0 0 10px;color:#14532d;font-size:18px;">${STATUS_TITLE}</h2>
    ${aqiBlock}
    <ul style="margin:10px 0 0;padding-inline-start:18px;">${bullets}</ul>
  </td></tr>`;
}

/** Plain-text status block prepended to the Markdown report. */
export function buildStatusMarkdown(items: ClassifiedItem[], aqi?: AqiReport): string {
  const aqiLines =
    aqi?.available && aqi.national
      ? [
          `**מדד איכות האוויר (AQI):** ממוצע ארצי ${aqi.national.aqi} (${aqi.national.status})`,
          ...aqi.cities.map((c) => `- ${c.name}: ${c.aqi} (${c.status})`),
        ].join('\n')
      : AQI_UNAVAILABLE;
  const s = buildSnapshot(items, aqi);
  return `## ${STATUS_TITLE}

${aqiLines}

**תמונת מצב:**
- ${s.air}
- ${s.pollution}
- ${s.waste}
- ${s.enforcement}
`;
}

// ---------------- Legislation & regulation section ----------------

const LEGAL_TERMS = [
  'חוק', 'תקנה', 'תקנות', 'רגולציה', 'חקיקה', 'תזכיר', 'הצעת חוק', 'תיקון',
  'רפורמה', 'דיון', 'ועדת', 'ועדה', 'החלטת ממשלה', 'כתב אישום', 'תביעה',
  'בג"ץ', 'עתירה', 'פסק דין', 'קנס', 'עיצום', 'הפרת', 'קריאה ראשונה',
  'קריאה שנייה', 'אכיפה', 'צו ',
];
const TENDER_TERMS = ['מכרז', 'מכרזים', 'קול קורא', 'הזמנה להציע'];

export interface LegislationResult {
  legal: ClassifiedItem[];
  rejectedTender: number;
  rejectedNotLegal: number;
}

/**
 * Pick legislation/regulation/enforcement items from the (already fresh,
 * non-gov.il, non-static) item set. Tenders are excluded explicitly.
 */
export function selectLegislation(items: ClassifiedItem[]): LegislationResult {
  const legal: ClassifiedItem[] = [];
  let rejectedTender = 0;
  let rejectedNotLegal = 0;
  for (const i of items) {
    const t = `${i.title} ${i.summary ?? ''}`;
    if (TENDER_TERMS.some((k) => t.includes(k))) {
      rejectedTender++;
      continue;
    }
    if (LEGAL_TERMS.some((k) => t.includes(k))) legal.push(i);
    else rejectedNotLegal++;
  }
  return { legal, rejectedTender, rejectedNotLegal };
}

/** One short Hebrew explanation of the legal/regulatory angle. */
function legislationExplanation(i: ClassifiedItem): string {
  const t = `${i.title} ${i.summary ?? ''}`;
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

/** Compact legislation & regulation section (between AQI and executive summary). */
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

/** Plain-text legislation block for the Markdown report. */
export function buildLegislationMarkdown(legal: ClassifiedItem[]): string {
  if (!legal.length) {
    return `## ${LEGISLATION_TITLE}\n\n${NO_LEGISLATION}\n`;
  }
  const lines = legal
    .map(
      (i) =>
        `- **${fmtDate(i.publishedAt)}** — [${i.title}](${i.url}) · ${i.source}\n  ${legislationExplanation(i)}`,
    )
    .join('\n');
  return `## ${LEGISLATION_TITLE}\n\n${lines}\n`;
}

/**
 * Build the visual Hebrew newsletter (RTL, table-based, inline styles for Gmail).
 * Images are referenced by URL (never attached); cards render fine without them.
 */
export function buildNewsletterHtml(
  items: ClassifiedItem[],
  aqi?: AqiReport,
  legal: ClassifiedItem[] = [],
  opts: NewsletterOptions = {},
): string {
  const fallbackBanner = opts.fallbackNote
    ? `<tr><td style="padding:10px 20px;background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13px;">${esc(FALLBACK_NOTICE)}</td></tr>`
    : '';
  const all = topItems(items, 12);
  const hero = all[0];
  const top = all.slice(1, 6); // up to 5 top stories
  const rest = all.slice(6); // remaining as link list

  const heroHtml = hero ? heroCard(hero) : '';
  const topHtml = top.length
    ? `<tr><td style="padding:18px 20px 0;"><h3 style="color:#166534;font-size:18px;margin:0;">הסיפורים החשובים השבוע</h3></td></tr>${top
        .map(storyCard)
        .join('')}`
    : '';
  const emptyHtml = all.length
    ? ''
    : `<tr><td style="padding:24px 20px;color:#374151;">לא נמצאו פריטים רלוונטיים וטריים השבוע.</td></tr>`;

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
      ${statusSectionHtml(all, aqi)}
      ${legislationSectionHtml(legal)}
      ${emptyHtml}
      ${heroHtml}
      ${topHtml}
      ${linksSection(rest)}
      ${summarySection(all)}
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
