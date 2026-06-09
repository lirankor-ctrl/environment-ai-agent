import type { Category } from './types.js';

/** Flat list of all keywords we monitor (used for matching + the report header). */
export const KEYWORDS: string[] = [
  'מחזור',
  'מיחזור',
  'פסולת',
  'פסולת אלקטרונית',
  'פסולת אריזות',
  'פלסטיק',
  'הטמנה',
  'חוק הפיקדון',
  'חוק האריזות',
  'תמיר',
  'אל"ה',
  'מאי',
  'ורידיס',
  'כלכלה מעגלית',
  'תחנת מעבר',
  'אתר הטמנה',
  'RDF',
  'קומפוסט',
  'פסולת בניין',
  'קיימות',
  'חדשנות',
  'טכנולוגיה',
  'מיזם',
  'פרויקט',
  'מחקר',
  'סטארטאפ',
];

/**
 * Maps each report category to the keywords that signal it.
 * An item can belong to several categories.
 */
export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  מחזור: ['מחזור', 'מיחזור', 'קומפוסט'],
  'ניהול פסולת': [
    'פסולת',
    'הטמנה',
    'אתר הטמנה',
    'תחנת מעבר',
    'RDF',
    'פסולת בניין',
    'פסולת אריזות',
    'אריזות',
  ],
  'כלכלה מעגלית': ['כלכלה מעגלית', 'כלכלה מחזורית'],
  קיימות: ['קיימות', 'בר-קיימא', 'ברות קיימא', 'ESG'],
  'מחזור פלסטיק': ['פלסטיק'],
  'פסולת אלקטרונית': ['פסולת אלקטרונית', 'אלקטרונית', 'פסולת חשמלית', 'סוללות'],
  'חדשנות סביבתית': ['חדשנות', 'טכנולוגיה', 'מיזם', 'פרויקט', 'סטארטאפ', 'פיתוח'],
  'מחקרים ופיתוח': ['מחקר', 'מחקרים', 'ניסוי', 'אוניברסיט', 'מכון מחקר'],
  'חברות סביבה ישראליות': ['ורידיס', 'אל"ה', 'תמיר', 'מאי', 'חברה'],
};

/** High-signal keywords that push an item to "High" importance on their own. */
export const HIGH_SIGNAL_KEYWORDS: string[] = [
  'חוק האריזות',
  'חוק הפיקדון',
  'כלכלה מעגלית',
  'חדשנות',
  'טכנולוגיה חדשה',
  'מחקר חדש',
  'מיזם חדש',
];

/**
 * Relevance keywords (used to "search" general news feeds).
 *
 * CORE = specific waste/recycling terms — their presence makes an item relevant
 * even if it also touches food/lifestyle/etc. Deliberately EXCLUDES ambiguous
 * tokens: bare "מחזור" (also "revenue/cycle"), "תמיר"/"מאי" (common names/month)
 * — those are handled with context disambiguation (see relevance.ts).
 */
export const CORE_KEYWORDS: string[] = [
  'מיחזור',
  'פסולת',
  'פסולת אריזות',
  'פסולת אלקטרונית',
  'פלסטיק',
  'כלכלה מעגלית',
  'חוק הפיקדון',
  'חוק האריזות',
  'חוק פסולת האריזות',
  'הטמנה',
  'RDF',
  'קומפוסט',
  'טיפול בפסולת',
  'הפרדת פסולת',
  'מפעל מחזור',
  'תאגיד תמיר',
  'ורידיס',
  'אל"ה',
  'נגב אקולוגיה',
];

/**
 * SOFT = broader environmental terms (require extra scrutiny via negative-topic
 * and event filters). "סביבה" is written as specific forms to avoid matching
 * "בסביבה" (=in the vicinity) common in unrelated news.
 */
export const SOFT_KEYWORDS: string[] = [
  'זיהום',
  'קיימות',
  'אקלים',
  'אנרגיה מתחדשת',
  'הסביבה',
  'סביבתי',
  'איכות הסביבה',
  'הגנת הסביבה',
];

/**
 * Full strong-keyword list. Includes the ambiguous, context-gated "מחזור"
 * (also revenue/cycle) and "אריזות" (also retail packaging) so they are still
 * COUNTED as matches; relevance.ts only treats them as recycling when recycling
 * context is present.
 */
export const STRONG_KEYWORDS: string[] = [...CORE_KEYWORDS, 'מחזור', 'אריזות', ...SOFT_KEYWORDS];
