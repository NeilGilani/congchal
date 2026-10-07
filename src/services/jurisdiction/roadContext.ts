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

const STATE_CODES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD ' +
    'TN TX UT VT VA WA WV WI WY PR').split(' '),
);

/**
 * "CA 82", "US 101", "I 280", "I-5", "SR 9", "TX FM 1960" → numbered state or
 * federal routes. A two-letter prefix must be a state code, so county roads
 * such as "CR 12" are not sent to the state DOT.
 */
export const isStateOrFederalRouteRef = (ref: string | undefined): boolean => {
  if (!ref) return false;
  return ref
    .split(';')
    .map((r) => r.trim())
    .some((r) => {
      const m = /^(US|I|SR|[A-Z]{2})[\s-]?(?:[A-Z]{1,3}\s)?\d+[A-Z]?$/i.exec(r);
      if (!m?.[1]) return false;
      const prefix = m[1].toUpperCase();
      return prefix === 'US' || prefix === 'I' || prefix === 'SR' || STATE_CODES.has(prefix);
    });
};

export const parseRoadContext = (data: OverpassResponse, point: LatLng, now = new Date()): RoadContext | undefined => {
  let best: { score: number; d: number; tags: Record<string, string> } | undefined;
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const highway = tags.highway;
    if (!highway || !ROAD_CLASSES.has(highway) || !el.center) continue;
    const d = distanceMeters(point, { latitude: el.center.lat, longitude: el.center.lon });
    // Prefer named/numbered roads when distances are similar.
    const penalty = tags.name || tags.ref ? 0 : 15;
    // The penalty only ranks candidates; the reported distance stays the real one.
    if (!best || d + penalty < best.score) best = { score: d + penalty, d, tags };
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
