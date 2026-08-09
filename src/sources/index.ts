import type { RawItem } from '../types.js';
import { log } from '../logger.js';
import { scrapeList, tryRss } from './http.js';
import { collectGoogleNews } from './googleNews.js';
import { collectInfospot, isInfospotStatic } from './infospot.js';

export interface Source {
  id: string;
  name: string;
  /** Marks the primary discovery layer vs. secondary direct sources (logging). */
  tier: 'primary' | 'secondary';
  collect: () => Promise<RawItem[]>;
  /** Optional predicate to drop static/directory/index pages. */
  isStatic?: (url: string, title: string) => boolean;
}

/** PRIMARY — Google News RSS keyword search (Hebrew, Israel, last 7 days). */
const googleNews: Source = {
  id: 'google-news',
  name: 'Google News (חיפוש מילות מפתח)',
  tier: 'primary',
  collect: collectGoogleNews,
};

/** PRIMARY — Infospot environmental/industry news portal (dedicated parser). */
const infospot: Source = {
  id: 'infospot',
  name: 'Infospot',
  tier: 'primary',
  collect: collectInfospot,
  isStatic: (url) => isInfospotStatic(url),
};

/** SECONDARY — Zavit science & environment news agency (WordPress feed). */
const zavit: Source = {
  id: 'zavit',
  name: 'זווית – סוכנות ידיעות למדע ולסביבה',
  tier: 'secondary',
  collect: async () =>
    tryRss('זווית – סוכנות ידיעות למדע ולסביבה', ['https://www.zavit.org.il/feed/']),
};

/** SECONDARY — ISEES Ecology & Environment magazine (research & studies). */
const isees: Source = {
  id: 'isees',
  name: 'מגזין אקולוגיה וסביבה (ISEES)',
  tier: 'secondary',
  collect: async () => {
    const rss = await tryRss('מגזין אקולוגיה וסביבה (ISEES)', [
      'https://magazine.isees.org.il/feed/',
      'https://magazine.isees.org.il/?feed=rss2',
    ]);
    if (rss.length) return rss;
    log.warn('ISEES: no RSS feed, scraping homepage article links.');
    return scrapeList({
      sourceName: 'מגזין אקולוגיה וסביבה (ISEES)',
      listUrl: 'https://magazine.isees.org.il/',
      linkSelector: 'a[href*="?p="]',
      baseUrl: 'https://magazine.isees.org.il',
    });
  },
};

// Google News first (primary), then the focused environmental sources.
export const SOURCES: Source[] = [googleNews, infospot, zavit, isees];
