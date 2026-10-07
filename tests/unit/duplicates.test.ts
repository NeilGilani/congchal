import type { PublicReport } from '@/models/civic';
import { categorySimilarity, mapRawCategory } from '@/services/civic/categoryMapping';
import { duplicateRadiusMeters, findDuplicateCandidates } from '@/services/civic/duplicateDetection';
import { distanceMeters } from '@/utils/geo';

const NOW = Date.parse('2026-10-06T17:00:00Z');
const here = { latitude: 37.3382, longitude: -121.8863 };

/** Point `meters` north of `here` (1° latitude ≈ 111,195 m). */
const north = (meters: number) => ({ latitude: here.latitude + meters / 111_195, longitude: here.longitude });

const report = (id: string, meters: number, extra: Partial<PublicReport> = {}): PublicReport => ({
  id,
  provider: 'test',
  providerName: 'Test 311',
  title: 'Pothole',
  mappedCategory: 'pothole',
  status: 'open',
  createdAt: '2026-10-01T12:00:00Z',
  ...north(meters),
  ...extra,
});

describe('distanceMeters', () => {
  it('matches known distances', () => {
    expect(distanceMeters(here, north(42))).toBeCloseTo(42, 0);
    // San José City Hall -> SF City Hall: 67.92 km (independently computed with Python).
    expect(distanceMeters(here, { latitude: 37.7793, longitude: -122.4193 }) / 1000).toBeCloseTo(67.92, 1);
  });
});

describe('duplicateRadiusMeters', () => {
  it('grows with GPS uncertainty within bounds', () => {
    expect(duplicateRadiusMeters(5)).toBe(50);
    expect(duplicateRadiusMeters(20)).toBe(70);
    expect(duplicateRadiusMeters(500)).toBe(150);
    expect(duplicateRadiusMeters(null)).toBe(80);
  });
});

describe('findDuplicateCandidates', () => {
  it('ranks a nearby same-category report first and reports its distance', () => {
    const out = findDuplicateCandidates('pothole', here, 75, [report('far', 70), report('near', 42)], NOW);
    expect(out.map((c) => c.report.id)).toEqual(['near', 'far']);
    expect(out[0]?.distanceMeters).toBe(42);
    expect(out[0]?.categoryMatch).toBe(1);
  });

  it('ignores reports outside the radius and unrelated categories', () => {
    const out = findDuplicateCandidates(
      'pothole',
      here,
      75,
      [report('outside', 120), report('graffiti', 10, { mappedCategory: 'graffiti', title: 'Graffiti' })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('keeps recently closed reports but drops old closed ones', () => {
    const recent = report('recent', 20, { status: 'closed', createdAt: '2026-09-20T00:00:00Z' });
    const old = report('old', 20, { status: 'closed', createdAt: '2026-05-01T00:00:00Z' });
    const out = findDuplicateCandidates('pothole', here, 75, [recent, old], NOW);
    expect(out.map((c) => c.report.id)).toEqual(['recent']);
    expect(out[0]?.score).toBeLessThan(1);
  });

  it('treats related categories as weaker matches', () => {
    const crack = report('crack', 10, { mappedCategory: 'pavement_crack' });
    const out = findDuplicateCandidates('pothole', here, 75, [crack], NOW);
    expect(out[0]?.categoryMatch).toBe(0.6);
  });
});

describe('mapRawCategory', () => {
  it.each([
    ['Pothole in Street Complaint', 'pothole'],
    ['Street Condition | Pothole', 'pothole'],
    ['Graffiti Removal Request', 'graffiti'],
    ['Fly Dump Complaint', 'illegal_dumping'],
    ['Bulky Items', 'illegal_dumping'],
    ['Overflowing Litter Baskets', 'overflowing_trash'],
    ['Street Sign - Damaged', 'damaged_sign'],
    ['Damaged Tree', 'fallen_tree'],
    ['Catch Basin Clogged/Flooding', 'flooding'],
    ['Sidewalk Condition', 'sidewalk_damage'],
    ['Noise - Residential', undefined],
  ])('%s -> %s', (text, expected) => {
    expect(mapRawCategory(text)).toBe(expected);
  });

  it('scores similarity symmetrically for related categories', () => {
    expect(categorySimilarity('overflowing_trash', 'illegal_dumping')).toBe(0.6);
    expect(categorySimilarity('illegal_dumping', 'overflowing_trash')).toBe(0.6);
    expect(categorySimilarity('graffiti', 'pothole')).toBe(0);
    expect(categorySimilarity('graffiti', undefined)).toBe(0.3);
  });
});
