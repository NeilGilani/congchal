import { z } from 'zod';

import { requestJson } from '@/api/http';
import type { Jurisdiction } from '@/models/location';
import type { LatLng } from '@/utils/geo';

/**
 * US Census Bureau Geocoder — "geographies by coordinates".
 * Free, keyless, official boundary data (TIGER/Line). Returns the state,
 * county and (if any) incorporated place or census-designated place that
 * contains the point.
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */
export const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';

const geography = z
  .object({
    NAME: z.string().optional(),
    BASENAME: z.string().optional(),
    GEOID: z.string().optional(),
    STATE: z.string().optional(),
    STUSAB: z.string().optional(),
    LSADC: z.string().optional(),
    FUNCSTAT: z.string().optional(),
  })
  .passthrough();

export const censusResponseSchema = z.object({
  result: z.object({
    geographies: z.record(z.string(), z.array(geography)),
  }),
});

export type CensusResponse = z.infer<typeof censusResponseSchema>;

export const buildCensusUrl = ({ latitude, longitude }: LatLng): string =>
  `${CENSUS_ENDPOINT}?x=${longitude.toFixed(6)}&y=${latitude.toFixed(6)}` +
  '&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json';

const first = (data: CensusResponse, ...layers: string[]) => {
  for (const layer of layers) {
    const g = data.result.geographies[layer]?.[0];
    if (g) return g;
  }
  return undefined;
};

/** Converts a Census response into a Jurisdiction; `undefined` if the point is outside US coverage. */
export const parseCensusJurisdiction = (data: CensusResponse, now = new Date()): Jurisdiction | undefined => {
  const state = first(data, 'States');
  if (!state) return undefined;
  const county = first(data, 'Counties');
  const incorporated = first(data, 'Incorporated Places');
  const cdp = first(data, 'Census Designated Places');

  const stateCode = state.STUSAB;
  const place = incorporated ?? cdp;
  const placeName = place?.BASENAME ?? place?.NAME;
  const countyName = county?.NAME ?? county?.BASENAME;

  const displayName = incorporated
    ? `${placeName}${stateCode ? `, ${stateCode}` : ''}`
    : countyName
      ? `${cdp ? `${placeName} (unincorporated), ` : 'Unincorporated '}${countyName}${stateCode ? `, ${stateCode}` : ''}`
      : (state.NAME ?? 'United States');

  return {
    country: 'US',
    state: { name: state.NAME ?? state.BASENAME ?? 'Unknown state', geoid: state.GEOID, code: stateCode },
    county: county ? { name: countyName ?? 'Unknown county', geoid: county.GEOID } : undefined,
    place: place && placeName ? { name: placeName, geoid: place.GEOID, incorporated: Boolean(incorporated) } : undefined,
    // Inside an incorporated place, local streets are usually the city's; in
    // unincorporated areas (including census-designated places) the county's.
    responsibleLevel: incorporated ? 'city' : county ? 'county' : 'unknown',
    displayName,
    source: 'census',
    confidence: 'authoritative',
    resolvedAt: now.toISOString(),
  };
};

export const fetchCensusJurisdiction = async (point: LatLng, signal?: AbortSignal): Promise<Jurisdiction | undefined> => {
  const data = await requestJson(buildCensusUrl(point), {
    schema: censusResponseSchema,
    label: 'Census geocoder',
    timeoutMs: 12_000,
    retries: 1,
    signal,
  });
  return parseCensusJurisdiction(data);
};
