export type Category =
  | 'מחזור'
  | 'ניהול פסולת'
  | 'כלכלה מעגלית'
  | 'קיימות'
  | 'מחזור פלסטיק'
  | 'פסולת אלקטרונית'
  | 'חדשנות סביבתית'
  | 'מחקרים ופיתוח'
  | 'חברות סביבה ישראליות';

export type Importance = 'High' | 'Medium' | 'Low';

/** A raw item as fetched from a source, before classification. */
export interface RawItem {
  title: string;
  url: string;
  source: string;
  /** ISO publication date. Items without one are rejected by the freshness step. */
  publishedAt?: string;
  summary?: string;
  /** The Google News query that surfaced this item (when applicable). */
  query?: string;
  /** Main article image URL (not attached — referenced from the source). */
  imageUrl?: string;
  imageSource?: 'og:image' | 'twitter:image' | 'article-img';
}

/** An item after keyword classification + importance ranking. */
export interface ClassifiedItem extends RawItem {
  categories: Category[];
  importance: Importance;
  matchedKeywords: string[];
  fetchedAt: string;
}
