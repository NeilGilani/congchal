import type { DuplicateCheckResult, LocalReportRef } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import type { Scan } from '@/models/scan';
import { getNearbyPublicReports } from '@/services/civic/civicDataService';
import { duplicateRadiusMeters, findDuplicateCandidates } from '@/services/civic/duplicateDetection';
import { fetchRoadContext } from '@/services/jurisdiction/roadContext';
import { resolvePlace } from '@/services/jurisdiction/jurisdictionService';
import { getRepositories, scansFor } from '@/storage/repositories';
import { log } from '@/utils/logger';
import { CATEGORY_INFO } from '@/constants/categories';

/** Category used for civic lookups: the user's choice wins over the model. */
export const effectiveCategory = (scan: Scan): IssueCategory | undefined =>
  scan.confirmedCategory ?? (scan.analysis.outcome !== 'none' ? scan.detections[0]?.category : undefined);

const localRefs = async (exceptId: string): Promise<LocalReportRef[]> => {
  const scans = await getRepositories().scans.list();
  return scans.flatMap((s) => {
    const cat = effectiveCategory(s);
    if (s.id === exceptId || !s.location || !cat) return [];
    return [
      {
        id: `local:${s.id}`,
        provider: 'local',
        providerName: 'Your CivicLens scans',
        title: CATEGORY_INFO[cat].label,
        mappedCategory: cat,
        status: s.status === 'resolved' ? 'closed' : 'open',
        latitude: s.location.latitude,
        longitude: s.location.longitude,
        createdAt: s.createdAt,
        scanId: s.id,
      },
    ];
  });
};

export const runDuplicateCheck = async (scan: Scan, signal?: AbortSignal): Promise<DuplicateCheckResult | undefined> => {
  const category = effectiveCategory(scan);
  if (!scan.location || !category) return undefined;
  const radius = duplicateRadiusMeters(scan.location.accuracy);
  const publicResult = await getNearbyPublicReports(scan.location, scan.jurisdiction, Math.max(radius, 150), signal);
  const locals = scan.isDemo ? [] : await localRefs(scan.id);
  const candidates = findDuplicateCandidates(category, scan.location, radius, [...publicResult.reports, ...locals]);
  return {
    checkedAt: new Date().toISOString(),
    radiusMeters: radius,
    candidates,
    sourcesChecked: [...publicResult.sourcesChecked, ...(locals.length || !scan.isDemo ? ['Your CivicLens scans'] : [])],
    sourcesFailed: publicResult.sourcesFailed,
    decision: scan.duplicateCheck?.decision,
    decidedAt: scan.duplicateCheck?.decidedAt,
  };
};

/**
 * Address, jurisdiction, road context and duplicate check for a scan with a
 * location. Each step can fail independently; whatever didn't complete stays
 * in `pendingLookups` and the sync worker retries it when back online.
 */
export const enrichScan = async (scanId: string, isDemo: boolean, signal?: AbortSignal): Promise<Scan | undefined> => {
  const col = scansFor(isDemo);
  let scan = await col.get(scanId);
  if (!scan?.location) return scan;
  const pending = new Set(scan.pendingLookups);
  const started = Date.now();

  if (pending.has('address') || pending.has('jurisdiction') || !scan.jurisdiction) {
    const place = await resolvePlace(scan.location, signal);
    if (place.address) pending.delete('address');
    if (place.jurisdiction?.confidence === 'authoritative') pending.delete('jurisdiction');
    else if (place.jurisdiction) pending.add('jurisdiction');
    scan = (await col.update(scanId, (s) => ({
      ...s,
      address: place.address ?? s.address,
      jurisdiction: place.jurisdiction ?? s.jurisdiction,
      pendingLookups: [...pending],
    }))) ?? scan;
  }

  const category = effectiveCategory(scan);
  const point = scan.location;
  if (category && point && !scan.roadContext && CATEGORY_INFO[category].typicalSurface !== 'structure') {
    try {
      const roadContext = await fetchRoadContext(point, signal);
      if (roadContext) scan = (await col.update(scanId, (s) => ({ ...s, roadContext }))) ?? scan;
    } catch {
      // Optional enrichment.
    }
  }

  if (category) {
    try {
      const duplicateCheck = await runDuplicateCheck(scan, signal);
      if (duplicateCheck) {
        if (duplicateCheck.sourcesFailed.length === 0) pending.delete('civic');
        scan = (await col.update(scanId, (s) => ({ ...s, duplicateCheck, pendingLookups: [...pending] }))) ?? scan;
      }
    } catch (e) {
      log.warn('CivicData', 'duplicate check failed', { error: e instanceof Error ? e.message : 'unknown' });
    }
  } else {
    pending.delete('civic');
    scan = (await col.update(scanId, (s) => ({ ...s, pendingLookups: [...pending] }))) ?? scan;
  }
  log.info('Sync', 'enriched', { pending: pending.size, latency: Date.now() - started });
  return scan;
};
