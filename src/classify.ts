import type { Category, ClassifiedItem, Importance, RawItem } from './types.js';
import { CATEGORY_KEYWORDS, KEYWORDS } from './keywords.js';

function haystack(item: RawItem): string {
  return `${item.title} ${item.summary ?? ''}`.toLowerCase();
}

/** Returns the monitored keywords that appear in the item. */
function findKeywords(item: RawItem): string[] {
  const text = haystack(item);
  return KEYWORDS.filter((kw) => text.includes(kw.toLowerCase()));
}

function findCategories(item: RawItem): Category[] {
  const text = haystack(item);
  const cats: Category[] = [];
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    if (kws.some((kw) => text.includes(kw.toLowerCase()))) cats.push(cat);
  }
  return cats;
}

const COMPANIES = ['ורידיס', 'אל"ה', 'תאגיד תמיר', 'נגב אקולוגיה'];
const ENV_CONTEXT = ['פסולת', 'מחזור', 'אריזות', 'פיקדון', 'זיהום', 'סביבת', 'הטמנה', 'rdf'];
const ENFORCEMENT = [
  'אכיפה',
  'כתב אישום',
  'תביעה',
  'כתב תביעה',
  'קנס',
  'עיצום',
  'בג"ץ',
  'הרשעה',
  'תביעה ייצוגית',
  'עונש',
  'חקירה',
];
const LAWS = ['חוק האריזות', 'חוק הפיקדון', 'חוק פסולת האריזות'];
const REG_WORDS = ['תקנות', 'רגולציה', 'חוק', 'רפורמה', 'תזכיר'];
const WASTE_WORDS = ['פסולת', 'מחזור', 'אריזות', 'פיקדון', 'rdf', 'הטמנה'];
const FACILITY = ['מתקן', 'מפעל', 'תחנת מעבר', 'מפעל מחזור', 'מטמנה'];
const POLLUTION_SEVERE = ['דליפה', 'שפך', 'חמור', 'מפגע', 'אסון', 'חירום', 'נחל', 'קרקע', 'אוויר'];

// Illegal dumping / burning / smuggling / large-quantity waste incidents.
const ILLEGAL_WASTE = [
  'שריפת פסולת', 'שורפים', 'שורף', 'נשרף', 'הצתת', 'בעירה',
  'השלכת פסולת', 'שפיכת פסולת', 'פסולת בלתי חוקית', 'פסולת לא חוקית',
  'מטמנה בלתי חוקית', 'מטמנות בלתי חוקיות', 'מטמנות פסולת בלתי',
  'פיראטי', 'פיראטית', 'הברחת פסולת', 'הוברח', 'הוברחו', 'טון פסולת', 'טונות',
];
// Recycling rankings / league tables.
const RANKING = ['דירוג', 'מדד', 'מקום ה', 'טבלת', 'המדורגת', 'מובילות', 'מובילה בדירוג'];

/**
 * Importance scoring per the editorial rules:
 *  High   — waste/recycling regulation, packaging/deposit law, major Israeli
 *           companies, enforcement/lawsuits, new waste facilities, major
 *           pollution incidents, national recycling policy.
 *  Medium — Israeli environmental research, sustainability projects,
 *           municipal waste projects.
 *  Low    — general environmental education / minor local items.
 */
function rankImportance(item: RawItem): Importance {
  const t = haystack(item);
  const a = (arr: string[]) => arr.some((k) => t.includes(k.toLowerCase()));

  // ---- High ----
  if (a(LAWS)) return 'High'; // packaging/deposit law (incl. violations & lawsuits)
  if (a(COMPANIES)) return 'High';
  if (a(ENFORCEMENT) && a(ENV_CONTEXT)) return 'High';
  if (a(REG_WORDS) && a(WASTE_WORDS)) return 'High';
  if (a(FACILITY) && a(['פסולת', 'מחזור', 'rdf', 'אריזות'])) return 'High';
  if (t.includes('זיהום') && a(POLLUTION_SEVERE)) return 'High';
  if (a(ILLEGAL_WASTE)) return 'High'; // illegal dumping / burning / smuggling / large quantities
  if (a(['מדיניות', 'תוכנית לאומית', 'יעדי', 'אסטרטגיה']) && a(['מחזור', 'פסולת'])) return 'High';

  // ---- Medium ----
  if (
    a(['מחקר', 'מחקרים', 'אוניברסיט', 'מכון', 'טכניון', 'מדענים']) &&
    a(['סביבה', 'פסולת', 'מחזור', 'אקלים', 'זיהום', 'קיימות'])
  ) {
    return 'Medium';
  }
  if (t.includes('קיימות') && a(['פרויקט', 'מיזם', 'תוכנית', 'יוזמה'])) return 'Medium';
  if (a(RANKING) && a(['מחזור', 'מיחזור', 'פסולת'])) return 'Medium'; // recycling rankings
  if (
    a(['עירייה', 'רשות מקומית', 'מועצה אזורית', 'מועצה מקומית', 'עירוני', 'ערים', 'רשויות']) &&
    a(['פסולת', 'מחזור', 'מיחזור', 'הפרדה'])
  ) {
    return 'Medium';
  }

  return 'Low';
}

/** Classify and rank a single raw item. */
export function classify(item: RawItem): ClassifiedItem {
  const matchedKeywords = findKeywords(item);
  const categories = findCategories(item);
  return {
    ...item,
    matchedKeywords,
    categories: categories.length ? categories : ['ניהול פסולת'],
    importance: rankImportance(item),
    fetchedAt: new Date().toISOString(),
  };
}
