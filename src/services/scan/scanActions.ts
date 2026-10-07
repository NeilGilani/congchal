import type { DuplicateCandidate } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import type { Report } from '@/models/report';
import type { Scan } from '@/models/scan';
import type { UserSettings } from '@/models/settings';
import { LocationService } from '@/services/location/locationService';
import { createDraftReport, updateReport } from '@/services/report/reportService';
import { deleteScanImage } from '@/storage/imageStore';
import { getRepositories, reportsFor, scansFor } from '@/storage/repositories';

import { enrichScan } from './enrichment';

/** Records the user's decision about a possible duplicate. */
export const applyDuplicateDecision = async (
  scan: Scan,
  decision: 'report_anyway' | 'still_present' | 'viewed_existing',
  candidate?: DuplicateCandidate,
): Promise<void> => {
  const now = new Date().toISOString();
  await scansFor(scan.isDemo).update(scan.id, (s) => ({
    ...s,
    duplicateCheck: s.duplicateCheck ? { ...s.duplicateCheck, decision, decidedAt: now } : s.duplicateCheck,
    observations: decision === 'still_present' ? [...s.observations, now] : s.observations,
    status: decision === 'still_present' && s.status === 'scanned' ? 'reviewed' : s.status,
  }));
  // Re-observing one of the user's own earlier scans: record it there too.
  if (decision === 'still_present' && candidate?.report.provider === 'local') {
    const earlierId = (candidate.report as { scanId: string }).scanId;
    await getRepositories().scans.update(earlierId, (s) => ({ ...s, observations: [...s.observations, now] }));
  }
};

/**
 * The human-in-the-loop step: the user confirms (or corrects) what the photo
 * shows. Only then is a report draft created.
 */
export const confirmAndDraftReport = async (scan: Scan, category: IssueCategory): Promise<Report> => {
  const categoryChanged = scan.confirmedCategory !== category;
  const updated =
    (await scansFor(scan.isDemo).update(scan.id, (s) => ({
      ...s,
      confirmedCategory: category,
      userReviewed: true,
      status: s.status === 'scanned' ? 'reviewed' : s.status,
      // A changed category needs a fresh duplicate check for that category.
      duplicateCheck: categoryChanged && s.duplicateCheck?.candidates.length === 0 ? undefined : s.duplicateCheck,
      pendingLookups: categoryChanged && s.location && !s.pendingLookups.includes('civic') ? [...s.pendingLookups, 'civic'] : s.pendingLookups,
    }))) ?? scan;
  if (categoryChanged && updated.location && !updated.isDemo) void enrichScan(updated.id, false).catch(() => undefined);
  const existing = (await reportsFor(scan.isDemo).list()).find((r) => r.scanId === scan.id);
  if (existing) {
    if (existing.category !== category || !existing.userReviewedDetection) {
      const det = updated.detections.find((d) => d.category === category);
      const next: Report = {
        ...existing,
        category,
        userReviewedDetection: true,
        detectionConfidence: det?.confidence,
        detectionConfidenceLevel: det?.confidenceLevel,
        severity: existing.severityOverridden ? existing.severity : det?.severity?.level,
      };
      await reportsFor(scan.isDemo).put(next);
      return next;
    }
    return existing;
  }
  return createDraftReport(updated, category);
};

export const markResolved = (scan: Scan, resolved: boolean): Promise<Scan | undefined> =>
  scansFor(scan.isDemo).update(scan.id, (s) => ({ ...s, status: resolved ? 'resolved' : s.userReviewed ? 'reviewed' : 'scanned' }));

export const deleteScan = async (scan: Scan): Promise<void> => {
  const reports = (await reportsFor(scan.isDemo).list()).filter((r) => r.scanId === scan.id);
  for (const r of reports) await reportsFor(scan.isDemo).remove(r.id);
  await scansFor(scan.isDemo).remove(scan.id);
  deleteScanImage(scan.imageUri);
};

export const clearAllHistory = async (): Promise<void> => {
  const repos = getRepositories();
  for (const s of [...(await repos.scans.list()), ...(await repos.demoScans.list())]) deleteScanImage(s.imageUri);
  await repos.reports.clear();
  await repos.scans.clear();
  await repos.demoReports.clear();
  await repos.demoScans.clear();
};

/**
 * For an uploaded photo without GPS data: attaches the device's current
 * position, only after the user confirms they are at the spot. The fix is
 * labeled `on-site` everywhere it is shown, so it is never presented as the
 * photo's own location. Draft reports for the scan pick it up too.
 */
export const attachCurrentLocation = async (scan: Scan, settings: UserSettings): Promise<Scan | undefined> => {
  if (scan.location) return scan;
  const fix = await LocationService.getCurrentFix(10_000);
  const location = { ...fix, source: 'on-site' as const };
  const updated = await scansFor(scan.isDemo).update(scan.id, (s) => ({
    ...s,
    location,
    pendingLookups: ['address', 'jurisdiction', 'civic'],
    updatedAt: new Date().toISOString(),
  }));
  for (const r of (await reportsFor(scan.isDemo).list()).filter((x) => x.scanId === scan.id && !x.location)) {
    await updateReport(r, { location });
  }
  if (updated && settings.civicLookupsEnabled && !settings.localOnlyMode) {
    void enrichScan(updated.id, updated.isDemo).catch(() => undefined);
  }
  return updated;
};
