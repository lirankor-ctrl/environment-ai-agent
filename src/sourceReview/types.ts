/** Types for the weekly Source Discovery & Review layer. */

export type Recommendation = 'KEEP' | 'MONITOR' | 'REMOVE';
export type NewSourceVerdict = 'ADD' | 'OBSERVE' | 'SKIP';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** How a candidate source can be read (drives the accessibility score). */
export interface AccessMethod {
  rss: boolean;
  rssUrl?: string;
  html: boolean;
}

/** A newly discovered candidate source, evaluated over the last 30 days. */
export interface DiscoveredSource {
  name: string; // publisher name (from Google News)
  domain: string; // bare hostname, e.g. "infospot.co.il"
  url: string; // homepage
  sampleUrl: string; // an example article that surfaced it
  score: number; // 1–10
  totalCount: number; // items seen in the last 30 days
  relevantCount: number; // of those, items passing the relevance filter
  datedCount: number; // of those, items with a real publication date
  access: AccessMethod;
  verdict: NewSourceVerdict;
  reason: string; // short Hebrew explanation
}

/** Review of a currently-configured source over the last 30 days. */
export interface ExistingSourceReview {
  id: string;
  name: string;
  scannedCount: number; // total articles fetched from the source
  relevantArticles: number; // passed the relevance filter (any age)
  usefulCount: number; // relevant AND fresh (≤30d)
  irrelevantCount: number; // failed the relevance filter
  freshCount: number; // dated within the last 30 days
  relevanceScore: number; // 1–10, share of scanned articles that are relevant
  reliabilityScore: number; // 1–10
  recommendation: Recommendation;
  notes: string;
}

/** The full result of one weekly review run. */
export interface SourceReviewResult {
  date: string; // YYYY-MM-DD
  recommendedNew: DiscoveredSource[]; // verdict === 'ADD'
  underObservation: DiscoveredSource[]; // verdict === 'OBSERVE'
  existing: ExistingSourceReview[];
  approval: {
    add: string[]; // domains recommended for addition
    remove: string[]; // ids recommended for removal
  };
}

/** One archived recommendation row (data/source-review-history.json). */
export interface HistoryEntry {
  date: string; // discovery date (YYYY-MM-DD)
  kind: 'new' | 'existing';
  name: string;
  url?: string;
  score?: number;
  recommendation: NewSourceVerdict | Recommendation;
  approvalStatus: ApprovalStatus;
  notes: string;
}

export interface SourceReviewHistory {
  entries: HistoryEntry[];
}

/** Optional user-supplied approvals (data/source-approvals.json). */
export interface SourceApprovals {
  /** Domains (new sources) or ids (existing) the user approved. */
  approve: string[];
  /** Domains or ids the user explicitly rejected. */
  reject: string[];
}
