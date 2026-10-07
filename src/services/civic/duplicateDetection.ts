import type { DuplicateCandidate, LocalReportRef, PublicReport } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import { distanceMeters, type LatLng } from '@/utils/geo';

import { categorySimilarity } from './categoryMapping';

/** Search radius: generous enough to absorb GPS error, small enough to stay "the same spot". */
export const duplicateRadiusMeters = (accuracy: number | null | undefined): number => {
  const acc = accuracy && Number.isFinite(accuracy) ? accuracy : 25;
  return Math.round(Math.min(150, Math.max(50, 30 + 2 * acc)));
};

const CLOSED_LOOKBACK_DAYS = 30;
const OPEN_LOOKBACK_DAYS = 365;

const ageInDays = (iso: string | undefined, now: number): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : undefined;
};

/**
 * Ranks existing reports that may describe the same problem.
 *
 * score = categoryMatch × distance decay, where reports of unrelated
 * categories are dropped, closed reports only count if recently closed, and
 * very old open reports are ignored.
 */
export const findDuplicateCandidates = (
  category: IssueCategory,
  point: LatLng,
  radiusMeters: number,
  reports: readonly (PublicReport | LocalReportRef)[],
  now = Date.now(),
  limit = 3,
): DuplicateCandidate[] => {
  const out: DuplicateCandidate[] = [];
  for (const report of reports) {
    const d = distanceMeters(point, report);
    if (d > radiusMeters) continue;
    const categoryMatch = categorySimilarity(category, report.mappedCategory);
    if (categoryMatch <= 0) continue;
    const age = ageInDays(report.createdAt, now);
    const closed = report.status === 'closed';
    if (closed && age !== undefined && age > CLOSED_LOOKBACK_DAYS) continue;
    if (!closed && age !== undefined && age > OPEN_LOOKBACK_DAYS) continue;
    const distanceScore = 1 - d / (radiusMeters * 1.25);
    const statusFactor = closed ? 0.6 : 1;
    out.push({
      report,
      distanceMeters: Math.round(d),
      categoryMatch,
      ageDays: age === undefined ? undefined : Math.floor(age),
      score: Math.max(0, categoryMatch * distanceScore * statusFactor),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
};

export const duplicateHeadline = (c: DuplicateCandidate, formatDist: (m: number) => string): string => {
  const what = c.categoryMatch === 1 ? 'Possible existing report' : 'Related report';
  return `${what} ${formatDist(c.distanceMeters)} away`;
};
