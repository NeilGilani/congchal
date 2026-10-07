import { describeNetworkError } from '@/api/http';
import type { CivicDataSourceInfo, PublicReport } from '@/models/civic';
import type { Jurisdiction } from '@/models/location';
import { TtlCache } from '@/storage/cache';
import { getDefaultStore } from '@/storage/kv';
import { coordKey, distanceMeters, isLikelyUnitedStates, type LatLng } from '@/utils/geo';
import { log } from '@/utils/logger';

import type { RequestTypeHint } from './departmentService';
import { fetchSeeClickFixRequestTypes, seeClickFixProvider } from './providers/seeClickFix';
import { socrataProviders } from './providers/socrata';
import type { CivicDataProvider } from './providers/types';

export interface NearbyReportsResult {
  reports: PublicReport[];
  sourcesChecked: string[];
  sourcesFailed: { source: string; reason: string }[];
  fromCache: boolean;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

let reportCache: TtlCache<PublicReport[]> | undefined;
let requestTypeCache: TtlCache<RequestTypeHint[]> | undefined;

export const ALL_PROVIDERS: readonly CivicDataProvider[] = [seeClickFixProvider, ...socrataProviders];

export const describeSources = (): CivicDataSourceInfo[] =>
  ALL_PROVIDERS.map((p) => ({ id: p.id, name: p.name, coverage: p.coverage, url: p.url }));

const isReportArray = (v: unknown): v is PublicReport[] => Array.isArray(v);
const isHintArray = (v: unknown): v is RequestTypeHint[] => Array.isArray(v);

/**
 * Retrieves existing public reports near a point from every applicable
 * source. Each source fails independently; partial results are returned with
 * the failures listed so the UI can say exactly what wasn't checked.
 */
export const getNearbyPublicReports = async (
  point: LatLng,
  jurisdiction: Jurisdiction | undefined,
  radiusMeters: number,
  signal?: AbortSignal,
  providers: readonly CivicDataProvider[] = ALL_PROVIDERS,
): Promise<NearbyReportsResult> => {
  reportCache ??= new TtlCache<PublicReport[]>(getDefaultStore(), 'nearby-reports', 30);
  const applicable = isLikelyUnitedStates(point) ? providers.filter((p) => p.appliesTo(jurisdiction, point)) : [];
  const result: NearbyReportsResult = { reports: [], sourcesChecked: [], sourcesFailed: [], fromCache: true };
  const seen = new Set<string>();

  await Promise.all(
    applicable.map(async (p) => {
      // ~110 m cells so small movements reuse the cache.
      const key = `${p.id}:${coordKey(point, 3)}:${Math.round(radiusMeters)}`;
      let reports = await reportCache?.get(key, isReportArray);
      if (!reports) {
        result.fromCache = false;
        const started = Date.now();
        try {
          reports = await p.fetchNearby(point, radiusMeters, signal);
          await reportCache?.set(key, reports, CACHE_TTL_MS);
          log.info('CivicData', 'fetched', { source: p.id, count: reports.length, latency: Date.now() - started });
        } catch (e) {
          result.sourcesFailed.push({ source: p.name, reason: describeNetworkError(e) });
          log.warn('CivicData', 'source failed', { source: p.id, latency: Date.now() - started });
          return;
        }
      }
      result.sourcesChecked.push(p.name);
      for (const r of reports) {
        if (seen.has(r.id)) continue;
        if (distanceMeters(point, r) > radiusMeters * 1.5) continue;
        seen.add(r.id);
        result.reports.push(r);
      }
    }),
  );
  return result;
};

/** Request types accepted by the local SeeClickFix organisation, if the area uses it. */
export const getLocalRequestTypes = async (point: LatLng, signal?: AbortSignal): Promise<RequestTypeHint[]> => {
  if (!isLikelyUnitedStates(point)) return [];
  requestTypeCache ??= new TtlCache<RequestTypeHint[]>(getDefaultStore(), 'request-types', 20);
  const key = coordKey(point, 2);
  const cached = await requestTypeCache.get(key, isHintArray);
  if (cached) return cached;
  try {
    const types = await fetchSeeClickFixRequestTypes(point, signal);
    await requestTypeCache.set(key, types, 7 * 24 * 3600 * 1000);
    return types;
  } catch {
    // Not every area uses SeeClickFix; absence is normal.
    return [];
  }
};
