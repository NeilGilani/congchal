import type { PublicReport } from '@/models/civic';
import { mapRawCategory } from '@/services/civic/categoryMapping';
import { filterAndSort, isUnresolved, publicToMapIssue, scanToMapIssue, toFeatureCollection, type MapIssue } from '@/services/civic/mapIssues';

import { makeDetection, makeFix, makeScan } from '../fixtures/records';

const here = { latitude: 37.3382, longitude: -121.8863 };
/** Point `meters` north of `here` (1° latitude ≈ 111,195 m). */
const north = (meters: number) => ({ latitude: here.latitude + meters / 111_195, longitude: here.longitude });

const publicReport = (extra: Partial<PublicReport> = {}): PublicReport => ({
  id: 'seeclickfix:16032211',
  provider: 'seeclickfix',
  providerName: 'SeeClickFix · City of San José',
  title: 'Pothole',
  rawCategory: 'Pothole Repair',
  mappedCategory: 'pothole',
  status: 'acknowledged',
  ...north(60),
  createdAt: '2026-10-01T15:32:00-07:00',
  ...extra,
});

const issue = (id: string, extra: Partial<MapIssue>): MapIssue => ({
  id,
  kind: 'public',
  group: 'roads',
  title: id,
  latitude: here.latitude,
  longitude: here.longitude,
  status: 'open',
  source: 'test',
  ...extra,
});

describe('scanToMapIssue', () => {
  it('turns a located detection into a local map issue with severity and distance', () => {
    const scan = makeScan({ location: makeFix(north(120)) });
    const m = scanToMapIssue(scan, here);
    expect(m).toMatchObject({
      id: 'local:scan_fixture',
      kind: 'local',
      category: 'pothole',
      group: 'roads',
      title: 'Pothole',
      severity: 'high',
      status: 'scanned',
      source: 'Your scan',
      scanId: 'scan_fixture',
      isDemo: false,
    });
    expect(m?.distanceMeters).toBeCloseTo(120, 3);
  });

  it('uses the category the user confirmed over the model\'s', () => {
    const m = scanToMapIssue(makeScan({ confirmedCategory: 'graffiti', status: 'reviewed' }));
    expect(m?.category).toBe('graffiti');
    expect(m?.group).toBe('other');
    // The pothole detection's severity does not carry over to a different category.
    expect(m?.severity).toBeUndefined();
    expect(m?.distanceMeters).toBeUndefined();
  });

  it('skips scans without a location or without an issue', () => {
    expect(scanToMapIssue(makeScan({ location: undefined }))).toBeUndefined();
    const nothing = makeScan({ detections: [], analysis: { ...makeScan().analysis, outcome: 'none' } });
    expect(scanToMapIssue(nothing)).toBeUndefined();
    // Even a stray detection does not appear when the outcome was "none".
    const noneWithDetection = makeScan({ analysis: { ...makeScan().analysis, outcome: 'none' } });
    expect(scanToMapIssue(noneWithDetection)).toBeUndefined();
  });

  it('labels demo scans', () => {
    expect(scanToMapIssue(makeScan({ isDemo: true }))?.source).toBe('Demo scan');
  });
});

describe('publicToMapIssue', () => {
  it('keeps the provider data and computes the distance', () => {
    const m = publicToMapIssue(publicReport(), here);
    expect(m).toMatchObject({
      id: 'seeclickfix:16032211',
      kind: 'public',
      category: 'pothole',
      group: 'roads',
      status: 'acknowledged',
      source: 'SeeClickFix · City of San José',
    });
    expect(m.distanceMeters).toBeCloseTo(60, 3);
  });

  it('puts unmapped request types in the "other" group', () => {
    const m = publicToMapIssue(publicReport({ title: 'Abandoned Vehicle', mappedCategory: undefined }));
    expect(m.group).toBe('other');
    expect(m.category).toBeUndefined();
  });
});

describe('filterAndSort', () => {
  const issues: MapIssue[] = [
    issue('old-low-near', { severity: 'low', createdAt: '2026-09-01T00:00:00Z', distanceMeters: 10 }),
    issue('new-mod-far', { severity: 'moderate', createdAt: '2026-10-05T00:00:00Z', distanceMeters: 400 }),
    issue('mid-high', { severity: 'high', createdAt: '2026-09-20T00:00:00Z', distanceMeters: 90 }),
    issue('graffiti', { group: 'other', category: 'graffiti', createdAt: '2026-10-06T00:00:00Z' }),
    issue('new-high', { severity: 'high', createdAt: '2026-10-02T00:00:00Z', distanceMeters: 250 }),
  ];
  const ids = (list: MapIssue[]) => list.map((i) => i.id);

  it('sorts newest first by default', () => {
    expect(ids(filterAndSort(issues, 'all', 'newest'))).toEqual(['graffiti', 'new-mod-far', 'new-high', 'mid-high', 'old-low-near']);
  });

  it('sorts by severity, newest first within a level, unknown severity last', () => {
    expect(ids(filterAndSort(issues, 'all', 'severity'))).toEqual(['new-high', 'mid-high', 'new-mod-far', 'old-low-near', 'graffiti']);
  });

  it('sorts by distance with unknown distances last', () => {
    expect(ids(filterAndSort(issues, 'all', 'distance'))).toEqual(['old-low-near', 'mid-high', 'new-high', 'new-mod-far', 'graffiti']);
  });

  it('filters by group without touching the input', () => {
    const before = ids([...issues]);
    expect(ids(filterAndSort(issues, 'other', 'newest'))).toEqual(['graffiti']);
    expect(filterAndSort(issues, 'waste', 'newest')).toEqual([]);
    filterAndSort(issues, 'all', 'distance');
    expect(ids(issues)).toEqual(before);
  });
});

describe('toFeatureCollection', () => {
  it('emits GeoJSON points as [longitude, latitude] with cluster properties', () => {
    const fc = toFeatureCollection([
      issue('a', { severity: 'high', ...north(10) }),
      issue('b', { status: 'closed' }),
      issue('c', { kind: 'local', status: 'resolved' }),
    ]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(3);
    expect(fc.features[0]).toEqual({
      type: 'Feature',
      id: 'a',
      geometry: { type: 'Point', coordinates: [here.longitude, north(10).latitude] },
      properties: { id: 'a', kind: 'public', sev: 'high', open: 1 },
    });
    expect(fc.features[1]?.properties).toMatchObject({ sev: 'none', open: 0 });
    expect(fc.features[2]?.properties).toMatchObject({ kind: 'local', open: 0 });
  });

  it('agrees with isUnresolved', () => {
    for (const status of ['open', 'acknowledged', 'unknown', 'scanned', 'reviewed', 'reported', 'closed', 'resolved'] as const) {
      const [f] = toFeatureCollection([issue(status, { status })]).features;
      expect(f?.properties?.open).toBe(isUnresolved(issue(status, { status })) ? 1 : 0);
    }
  });
});

describe('mapRawCategory with real 311 request types', () => {
  it.each([
    ['Pothole in Street', 'pothole'],
    ['Pothole', 'pothole'],
    ['Graffiti Removal', 'graffiti'],
    ['Illegal Dumping', 'illegal_dumping'],
    ['Bulky Item Collection', 'illegal_dumping'],
    ['Dirty Condition', 'overflowing_trash'],
    ['Overflowing Litter Basket', 'overflowing_trash'],
    ['Street and Sidewalk Cleaning', 'overflowing_trash'],
    ['Street Sign - Missing', 'damaged_sign'],
    ['Tree Debris', 'fallen_tree'],
    ['Sewer Backup', 'flooding'],
    ['Sidewalk Repair', 'sidewalk_damage'],
    ['Blocked Sidewalk', 'pedestrian_obstruction'],
    ['Blocked Driveway', undefined],
    ['Abandoned Vehicle', undefined],
    ['Rodent', undefined],
  ])('%s -> %s', (text, expected) => {
    expect(mapRawCategory(text)).toBe(expected);
  });

  it('combines descriptor and type, most specific first (NYC 311 style)', () => {
    expect(mapRawCategory('Pothole', 'Street Condition')).toBe('pothole');
    expect(mapRawCategory('Trash', 'Dirty Condition')).toBe('overflowing_trash');
    expect(mapRawCategory('Loud Music/Party', 'Noise - Residential')).toBeUndefined();
  });

  it('returns undefined when there is no text', () => {
    expect(mapRawCategory()).toBeUndefined();
    expect(mapRawCategory(undefined, '')).toBeUndefined();
  });
});
