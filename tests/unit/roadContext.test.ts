import { isStateOrFederalRouteRef, overpassSchema, parseRoadContext } from '@/services/jurisdiction/roadContext';

const here = { latitude: 37.3297, longitude: -121.8951 };
const NOW = new Date('2026-10-06T17:00:00Z');

/** Centre `meters` north of `here` (1° latitude ≈ 111,195 m). */
const centerNorth = (meters: number) => ({ lat: here.latitude + meters / 111_195, lon: here.longitude });

/**
 * Overpass `way(around:30,...)[highway]; out tags center 20;` near SR 87
 * (Guadalupe Parkway) in San José. In OSM, California state routes carry
 * `ref=CA 87`.
 */
const overpass = {
  version: 0.6,
  generator: 'Overpass API 0.7.62.1 084b4234',
  osm3s: { timestamp_osm_base: '2026-10-06T16:58:21Z', copyright: 'The data included in this document is from www.openstreetmap.org.' },
  elements: [
    { type: 'way', id: 25280541, center: centerNorth(2), tags: { highway: 'footway', footway: 'sidewalk' } },
    { type: 'way', id: 25280542, center: centerNorth(4), tags: { highway: 'service', service: 'parking_aisle' } },
    {
      type: 'way',
      id: 8915471,
      center: centerNorth(9),
      tags: { highway: 'motorway', name: 'Guadalupe Parkway', ref: 'CA 87', lanes: '3', oneway: 'yes', sidewalk: 'no' },
    },
    { type: 'way', id: 8915472, center: centerNorth(24), tags: { highway: 'secondary', name: 'West Julian Street', sidewalk: 'both' } },
    { type: 'way', id: 8915473, tags: { highway: 'primary', name: 'No Center Avenue' } },
  ],
};

describe('isStateOrFederalRouteRef', () => {
  it.each([
    ['CA 82', true],
    ['US 101', true],
    ['I 280', true],
    ['I-5', true],
    ['SR 87', true],
    ['TX FM 1960', true],
    ['US 101;CA 82', true],
    ['Main St', false],
    // Regression: county roads were treated as state routes.
    ['CR 12', false],
    ['CO 12', true],
    ['G4', false],
    ['', false],
    [undefined, false],
  ])('%s -> %s', (ref, expected) => {
    expect(isStateOrFederalRouteRef(ref)).toBe(expected);
  });
});

describe('parseRoadContext', () => {
  it('picks the nearest named road and flags the state route', () => {
    const ctx = parseRoadContext(overpassSchema.parse(overpass), here, NOW);
    expect(ctx).toEqual({
      nearestRoadName: 'Guadalupe Parkway',
      roadClass: 'motorway',
      routeRef: 'CA 87',
      isStateRoute: true,
      hasSidewalkTag: false,
      distanceMeters: 9,
      source: 'openstreetmap',
      fetchedAt: '2026-10-06T17:00:00.000Z',
    });
  });

  it('ignores footways and ways without a centre', () => {
    const onlyIgnored = { elements: [overpass.elements[0], overpass.elements[4]] };
    expect(parseRoadContext(overpassSchema.parse(onlyIgnored), here, NOW)).toBeUndefined();
  });

  it('reports a city street with sidewalks as not a state route', () => {
    const cityStreet = { elements: [overpass.elements[3]] };
    const ctx = parseRoadContext(overpassSchema.parse(cityStreet), here, NOW);
    expect(ctx?.nearestRoadName).toBe('West Julian Street');
    expect(ctx?.isStateRoute).toBe(false);
    expect(ctx?.hasSidewalkTag).toBe(true);
    expect(ctx?.distanceMeters).toBe(24);
  });

  it('leaves the sidewalk flag unknown when the way has no sidewalk tag', () => {
    const ctx = parseRoadContext(
      overpassSchema.parse({ elements: [{ type: 'way', id: 1, center: centerNorth(5), tags: { highway: 'residential', name: 'Delmas Avenue' } }] }),
      here,
      NOW,
    );
    expect(ctx?.hasSidewalkTag).toBeUndefined();
  });

  it('reports the real distance of an unnamed road, without the ranking penalty', () => {
    const ctx = parseRoadContext(
      overpassSchema.parse({ elements: [{ type: 'way', id: 2, center: centerNorth(2), tags: { highway: 'service' } }] }),
      here,
      NOW,
    );
    expect(ctx?.distanceMeters).toBe(2);
  });

  it('returns undefined when nothing is nearby', () => {
    expect(parseRoadContext({ elements: [] }, here, NOW)).toBeUndefined();
  });

  it('rejects an Overpass error body', () => {
    expect(overpassSchema.safeParse({ remark: 'runtime error: Query timed out' }).success).toBe(false);
    expect(overpassSchema.safeParse({ elements: [{ type: 'way', id: '1' }] }).success).toBe(false);
  });
});
