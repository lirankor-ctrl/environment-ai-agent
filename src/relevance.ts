import { CORE_KEYWORDS, SOFT_KEYWORDS, STRONG_KEYWORDS } from './keywords.js';
import type { RawItem } from './types.js';

// Context that confirms "מחזור"/"אריזות" mean recycling/packaging-waste
// (not revenue, blood-cycle, or retail packaging).
const RECYCLING_CONTEXT = [
  'בקבוק',
  'בקבוקים',
  'פלסטיק',
  'זבל',
  'אשפה',
  'פחים',
  'הטמנה',
  'קומפוסט',
  'פיקדון',
  'מכל',
  'נייר',
  'זכוכית',
  'קרטון',
  'אלקטרונ',
  'פסולת',
  'מיחזור',
  'הפרד',
];

/**
 * Ambiguous Hebrew tokens that need word-boundary matching to avoid substring
 * traps, e.g. "קיימות" inside "מתקיימות" (=are held), or "פלסטיק" inside
 * "פלסטיקה" (=plastic surgery). A leading one-letter prefix (ה/ו/ב/ל/ש/כ/מ) is
 * allowed; the token must not be glued to other Hebrew letters.
 */
const AMBIGUOUS = new Set([
  'מחזור',
  'אריזות',
  'קיימות',
  'פלסטיק',
  'אקלים',
  'זיהום',
  'הסביבה',
  'סביבתי',
]);

export type RelevanceReason = 'ok' | 'no-keyword' | 'negative' | 'event' | 'foreign';

export interface Relevance {
  relevant: boolean;
  reason: RelevanceReason;
  matched: string[];
}

// Events / tours — rejected unless the item is clearly a recycling/environment
// industry conference (כנס/ועידה/תערוכה are NOT in this list, so they survive).
const EVENT_TERMS = [
  'סיור',
  'סיורים',
  'טיול',
  'טיולים',
  'פסטיבל',
  'יום כיף',
  'סדנה',
  'סדנת',
  'מופע',
  'הופעה',
  'מפגש',
  'מצעד',
  'תהלוכה',
  'ערב קהילתי',
  'פעילות לכל המשפחה',
];

// Off-topic subjects to reject (when no CORE waste keyword is present).
const NEGATIVE_TERMS = [
  'גינון',
  'גינה',
  'גנן',
  'ילדים',
  'פעוטות',
  'גן ילדים',
  'אופנה',
  'לייפסטייל',
  'יופי',
  'איפור',
  'תיירות',
  'חופשה',
  'נופש',
  'טיסות',
  'סלב',
  'סלבריטי',
  'ריאליטי',
  'האח הגדול',
  'זמר',
  'זמרת',
  'שחקן',
  'שחקנית',
  'מתכון',
  'מתכונים',
  'מסעדה',
  'שף',
  'בישול',
];

const POLITICS_TERMS = ['בחירות', 'קואליציה', 'אופוזיציה', 'נתניהו', 'גנץ', 'לפיד', 'מנדטים'];
const POLICY_TERMS = ['חוק', 'מדיניות', 'רגולציה', 'תקנות', 'פסולת', 'מחזור', 'אריזות', 'פיקדון', 'זיהום', 'אכיפה'];

// Signals that an article is centrally about Israel.
const ISRAEL_SIGNALS = [
  'ישראל', 'ישראלי', 'ישראלית', 'המשרד להגנת הסביבה', 'תאגיד תמיר', 'ורידיס', 'אל"ה',
  'נגב אקולוגיה', 'כנסת', 'עירייה', 'עיריית', 'רשות מקומית', 'מועצה אזורית', 'מועצה מקומית',
  'תל אביב', 'ירושלים', 'חיפה', 'באר שבע', 'אשדוד', 'נתניה', 'ראשון לציון', 'פתח תקווה',
  'רמלה', 'לוד', 'הרצליה', 'רעננה', 'כפר סבא', 'אשקלון', 'חולון', 'בת ים', 'רחובות',
  'מודיעין', 'הנגב', 'הגליל', 'השרון', 'יהודה ושומרון', 'יו"ש', 'רש"פ', 'אור עקיבא',
  'קלנדיה', 'אל-עזריה', 'גדה המערבית',
];

// Foreign countries/regions that suggest the story is about elsewhere.
const FOREIGN_COUNTRIES = [
  'גרמניה', 'ארה"ב', 'ארצות הברית', 'סין', 'וייטנאם', 'הודו', 'צרפת', 'בריטניה', 'אנגליה',
  'יפן', 'איטליה', 'ספרד', 'הולנד', 'שוודיה', 'נורווגיה', 'ברזיל', 'קנדה', 'אוסטרליה',
  'רוסיה', 'אוקראינה', 'טורקיה', 'דרום קוריאה', 'אינדונזיה', 'תאילנד', 'אירופה', 'אפריקה',
  'האיחוד האירופי',
];

// Obviously-foreign publishers (used only when no Israel signal is present).
const FOREIGN_PUBLISHER_HINTS = ['vietnam', '.vn', 'xinhua', 'reuters', 'bloomberg', 'bbc', 'cnn', 'aljazeera', 'الجزيرة', '.ru', '.cn'];

/** Reject foreign articles unless Israel is clearly central. */
function isIsraelRelevant(t: string, source: string): boolean {
  if (anyIn(t, ISRAEL_SIGNALS)) return true;
  const src = source.toLowerCase();
  const foreignPublisher = FOREIGN_PUBLISHER_HINTS.some((h) => src.includes(h));
  if (anyIn(t, FOREIGN_COUNTRIES) || foreignPublisher) return false;
  return true; // no foreign signal and no Israel signal -> treat as local Israeli news
}

function text(item: RawItem): string {
  return `${item.title} ${item.summary ?? ''}`.toLowerCase();
}

/** Match a single keyword. Ambiguous Hebrew tokens use word-boundary matching. */
function matchKw(t: string, kw: string): boolean {
  const k = kw.toLowerCase();
  if (AMBIGUOUS.has(kw)) {
    // (start | non-Hebrew-letter)(optional 1-letter prefix)KW(not followed by Hebrew letter)
    const re = new RegExp(`(?:^|[^\\u05d0-\\u05ea])[\\u05d4\\u05d5\\u05d1\\u05dc\\u05e9\\u05db\\u05de]?${k}(?![\\u05d0-\\u05ea])`);
    return re.test(t);
  }
  return t.includes(k);
}

const matchedIn = (t: string, arr: string[]) => arr.filter((k) => matchKw(t, k));
const anyIn = (t: string, arr: string[]) => arr.some((k) => matchKw(t, k));

/** True when the text is about recycling in the CORE sense. */
function isCoreRecycling(t: string): boolean {
  if (anyIn(t, CORE_KEYWORDS)) return true;
  // ambiguous "מחזור"/"אריזות" count only with explicit recycling context.
  if ((matchKw(t, 'מחזור') || matchKw(t, 'אריזות')) && anyIn(t, RECYCLING_CONTEXT)) return true;
  return false;
}

/**
 * Two-stage relevance filter:
 *  1) must match at least one strong keyword (else 'no-keyword'),
 *  2) CORE waste/recycling topic -> always relevant (overrides negatives);
 *     otherwise it's a SOFT-only (or ambiguous "מחזור") item -> reject if it's
 *     an event/tour, off-topic (lifestyle/food/travel/politics), or a bare
 *     ambiguous "מחזור" with no recycling context (e.g. revenue/turnover).
 */
export function assessRelevance(item: RawItem): Relevance {
  const t = text(item);
  const matched = matchedIn(t, STRONG_KEYWORDS);
  if (!matched.length) return { relevant: false, reason: 'no-keyword', matched: [] };

  // ---- Topical relevance ----
  if (!isCoreRecycling(t)) {
    // Not core. If there's no genuine soft environmental term either, the only
    // match was the ambiguous "מחזור" (revenue/cycle) — reject as irrelevant.
    if (!anyIn(t, SOFT_KEYWORDS)) return { relevant: false, reason: 'negative', matched };
    // Soft environmental match only — apply stricter filters.
    if (anyIn(t, EVENT_TERMS)) return { relevant: false, reason: 'event', matched };
    if (anyIn(t, NEGATIVE_TERMS)) return { relevant: false, reason: 'negative', matched };
    if (anyIn(t, POLITICS_TERMS) && !anyIn(t, POLICY_TERMS)) {
      return { relevant: false, reason: 'negative', matched };
    }
    if (t.includes('אקלים') && (t.includes('דעה') || t.includes('טור')) && !t.includes('ישראל')) {
      return { relevant: false, reason: 'negative', matched };
    }
  }

  // ---- Israel-relevance gate (applies to core + soft) ----
  if (!isIsraelRelevant(t, item.source ?? '')) {
    return { relevant: false, reason: 'foreign', matched };
  }

  return { relevant: true, reason: 'ok', matched };
}
