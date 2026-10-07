import { z } from 'zod';

import { requestJson } from '@/api/http';
import { appConfig } from '@/constants/config';
import type { RoadContext } from '@/models/location';
import { distanceMeters, type LatLng } from '@/utils/geo';

/**
 * Nearby road context from OpenStreetMap via the Overpass API. Used for one
 * thing: noticing that a roadway issue sits on a numbered state/US route,
 * which is usually maintained by the state DOT rather than the city.
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export const overpassSchema = z.object({
  elements: z.array(
    z
      .object({
        type: z.string(),
        id: z.number(),
        center: z.object({ lat: z.number(), lon: z.number() }).optional(),
        tags: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
  ),
});

export type OverpassResponse = z.infer<typeof overpassSchema>;

const ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'living_street',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link',
  'tertiary_link',
]);

/** "CA 82", "US 101", "I 280", "I-5", "SR 9", "TX FM 1960" → numbered state/federal routes. */
export const isStateOrFederalRouteRef = (ref: string | undefined): boolean => {
  if (!ref) return false;
  return ref
    .split(';')
    .map((r) => r.trim())
    .some((r) => /^(US|I|SR|[A-Z]{2})[\s-]?(?:[A-Z]{1,3}\s)?\d+[A-Z]?$/i.test(r));
};

export const parseRoadContext = (data: OverpassResponse, point: LatLng, now = new Date()): RoadContext | undefined => {
  let best: { d: number; tags: Record<string, string> } | undefined;
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const highway = tags.highway;
    if (!highway || !ROAD_CLASSES.has(highway) || !el.center) continue;
    const d = distanceMeters(point, { latitude: el.center.lat, longitude: el.center.lon });
    // Prefer named/numbered roads when distances are similar.
    const penalty = tags.name || tags.ref ? 0 : 15;
    if (!best || d + penalty < best.d) best = { d: d + penalty, tags };
  }
  if (!best) return undefined;
  const t = best.tags;
  const sidewalk = t.sidewalk;
  return {
    nearestRoadName: t.name,
    roadClass: t.highway,
    routeRef: t.ref,
    isStateRoute: isStateOrFederalRouteRef(t.ref),
    hasSidewalkTag: sidewalk ? sidewalk !== 'no' && sidewalk !== 'none' : undefined,
    distanceMeters: Math.round(best.d),
    source: 'openstreetmap',
    fetchedAt: now.toISOString(),
  };
};

export const fetchRoadContext = async (point: LatLng, signal?: AbortSignal): Promise<RoadContext | undefined> => {
  const q = `[out:json][timeout:10];way(around:30,${point.latitude.toFixed(6)},${point.longitude.toFixed(6)})[highway];out tags center 20;`;
  const data = await requestJson(`${OVERPASS_URL}?data=${encodeURIComponent(q)}`, {
    schema: overpassSchema,
    label: 'Overpass',
    timeoutMs: 12_000,
    retries: 1,
    minIntervalMs: 1000,
    headers: { 'User-Agent': appConfig.userAgent },
    signal,
  });
  return parseRoadContext(data, point);
};
