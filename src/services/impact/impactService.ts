import type { Report } from '@/models/report';
import type { Scan } from '@/models/scan';
import { classifyAccuracy } from '@/services/location/locationQuality';

export interface ImpactStats {
  issuesIdentified: number;
  reportsCreated: number;
  reportsShared: number;
  duplicatesAvoided: number;
  resolved: number;
  verifiedObservations: number;
  streakDays: number;
  /** 0..100, average completeness/quality of shared reports; undefined if none. */
  reportQuality?: number;
}

const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** A "verified observation": a scan the user reviewed, with a usable photo. Low-quality scans never count. */
export const isVerifiedObservation = (s: Scan): boolean =>
  !s.isDemo && s.userReviewed && s.quality.ok && Boolean(s.confirmedCategory ?? s.detections[0]);

export const reportQualityScore = (r: Report, scan: Scan | undefined): number => {
  const parts = [
    scan?.quality.ok && !scan.quality.issues.length ? 1 : scan?.quality.ok ? 0.6 : 0,
    r.detectionConfidence !== undefined ? Math.min(1, r.detectionConfidence / 0.9) : 0.5,
    r.userReviewedDetection ? 1 : 0,
    scan?.duplicateCheck ? 1 : 0.5,
    r.location ? (classifyAccuracy(r.location.accuracy) === 'poor' ? 0.5 : 1) : 0,
    r.description.trim().length >= 40 ? 1 : 0.5,
  ];
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);
};

/** Consecutive days (ending today or yesterday) with at least one verified observation. */
export const civicStreak = (scans: readonly Scan[], now = new Date()): number => {
  const days = new Set(scans.filter(isVerifiedObservation).map((s) => dayKey(s.createdAt)));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor.toISOString()))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(cursor.toISOString()))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
};

/** All numbers come from the user's own stored data; demo data is excluded. */
export const computeImpact = (scans: readonly Scan[], reports: readonly Report[], now = new Date()): ImpactStats => {
  const real = scans.filter((s) => !s.isDemo);
  const realReports = reports.filter((r) => !r.isDemo);
  const shared = realReports.filter((r) => r.exports.length > 0);
  const byId = new Map(real.map((s) => [s.id, s]));
  return {
    issuesIdentified: real.filter((s) => s.analysis.outcome === 'detected' || Boolean(s.confirmedCategory)).length,
    reportsCreated: realReports.length,
    reportsShared: shared.length,
    duplicatesAvoided: real.filter(
      (s) => (s.duplicateCheck?.decision === 'still_present' || s.duplicateCheck?.decision === 'viewed_existing') && s.status !== 'reported',
    ).length,
    resolved: real.filter((s) => s.status === 'resolved').length,
    verifiedObservations: real.filter(isVerifiedObservation).length,
    streakDays: civicStreak(real, now),
    reportQuality: shared.length
      ? Math.round(shared.reduce((sum, r) => sum + reportQualityScore(r, byId.get(r.scanId)), 0) / shared.length)
      : undefined,
  };
};
