import type { IssueCategory } from './issue';

export type PublicReportStatus = 'open' | 'acknowledged' | 'closed' | 'unknown';

/** A report that exists in a public 311 / civic-issue system. Never fabricated. */
export interface PublicReport {
  /** Provider-scoped id, e.g. "seeclickfix:123456". */
  id: string;
  provider: string;
  providerName: string;
  title: string;
  description?: string;
  rawCategory?: string;
  mappedCategory?: IssueCategory;
  status: PublicReportStatus;
  rawStatus?: string;
  latitude: number;
  longitude: number;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Public web page for the report, if the provider has one. */
  url?: string;
  imageUrl?: string;
}

export interface DepartmentMatch {
  /** e.g. "Public Works" / "Department of Transportation". */
  name: string;
  /** Organisation the department belongs to, e.g. "City of San Jose". */
  organization?: string;
  certainty: 'confirmed' | 'likely' | 'general';
  /** Why we think so, shown to the user. */
  basis: string;
  /** Official reporting channel, if known. */
  reportingUrl?: string;
  reportingLabel?: string;
  phone?: string;
  /** Request type in the jurisdiction's own system (e.g. SeeClickFix request type). */
  requestType?: string;
}

export interface DuplicateCandidate {
  report: PublicReport | LocalReportRef;
  distanceMeters: number;
  /** 0..1 similarity of category (1 = same category). */
  categoryMatch: number;
  ageDays?: number;
  score: number;
}

export interface LocalReportRef {
  id: string;
  provider: 'local';
  providerName: string;
  title: string;
  mappedCategory?: IssueCategory;
  status: 'open' | 'closed';
  latitude: number;
  longitude: number;
  createdAt: string;
  scanId: string;
}

export interface DuplicateCheckResult {
  checkedAt: string;
  radiusMeters: number;
  candidates: DuplicateCandidate[];
  sourcesChecked: string[];
  sourcesFailed: { source: string; reason: string }[];
  /** The user's decision, once made. */
  decision?: 'report_anyway' | 'still_present' | 'viewed_existing';
  decidedAt?: string;
}

export interface CivicDataSourceInfo {
  id: string;
  name: string;
  coverage: string;
  url: string;
}
