import { photographedAt } from '@/models/scan';
import { DEFAULT_SETTINGS } from '@/models/settings';
import { LocationService } from '@/services/location/locationService';
import { checkReport, createDraftReport, generateDescription } from '@/services/report/reportService';
import { attachCurrentLocation } from '@/services/scan/scanActions';
import { createMemoryStore } from '@/storage/kv';
import { createRepositories, getRepositories, reportsFor, setRepositories } from '@/storage/repositories';

import { LOCAL_EVENING, makeFix, makeScan } from '../fixtures/records';

/** No network in these tests: civic lookups off. */
const SETTINGS = { ...DEFAULT_SETTINGS, civicLookupsEnabled: false };
const HERE = makeFix({ latitude: 47.6062, longitude: -122.3321, accuracy: 6, source: 'gps' });

describe('photographedAt', () => {
  it("uses an uploaded photo's own EXIF time", () => {
    const taken = new Date(2026, 8, 28, 8, 15).toISOString();
    expect(photographedAt(makeScan({ source: 'gallery', location: makeFix({ source: 'photo-exif', timestamp: taken }) }))).toBe(taken);
  });

  it('uses the scan time for camera scans and for on-site locations', () => {
    const later = new Date(2026, 9, 7, 12, 0).toISOString();
    expect(photographedAt(makeScan({ location: makeFix({ timestamp: later }) }))).toBe(LOCAL_EVENING);
    expect(photographedAt(makeScan({ source: 'gallery', location: makeFix({ source: 'on-site', timestamp: later }) }))).toBe(LOCAL_EVENING);
    expect(photographedAt(makeScan({ location: undefined }))).toBe(LOCAL_EVENING);
  });

  it('puts the photo time, not the upload time, in the generated description', () => {
    const taken = new Date(2026, 8, 28, 8, 15).toISOString();
    const scan = makeScan({ source: 'gallery', location: makeFix({ source: 'photo-exif', timestamp: taken }) });
    const text = generateDescription(scan, 'pothole');
    expect(text).toContain('September 28, 2026');
    expect(text).not.toContain('October 6, 2026');
  });
});

describe('attachCurrentLocation', () => {
  let fixSpy: jest.SpyInstance;

  beforeEach(() => {
    setRepositories(createRepositories(createMemoryStore()));
    fixSpy = jest.spyOn(LocationService, 'getCurrentFix').mockResolvedValue(HERE);
  });

  afterEach(() => fixSpy.mockRestore());

  it('attaches the current position to an uploaded photo without GPS, labeled on-site', async () => {
    const scan = makeScan({ id: 'scan_upload', source: 'gallery', location: undefined, pendingLookups: [] });
    await getRepositories().scans.put(scan);

    const updated = await attachCurrentLocation(scan, SETTINGS);

    expect(updated?.location).toEqual({ ...HERE, source: 'on-site' });
    expect(updated?.pendingLookups).toEqual(['address', 'jurisdiction', 'civic']);
    expect((await getRepositories().scans.get('scan_upload'))?.location?.source).toBe('on-site');
  });

  it('fills the location of an existing draft report so it can pass the checklist', async () => {
    const scan = makeScan({ id: 'scan_upload', source: 'gallery', location: undefined, pendingLookups: [] });
    await getRepositories().scans.put(scan);
    const draft = await createDraftReport(scan, 'pothole');
    expect(checkReport(draft).find((c) => c.id === 'location')?.passed).toBe(false);

    await attachCurrentLocation(scan, SETTINGS);

    const report = await reportsFor(false).get(draft.id);
    expect(report?.location?.source).toBe('on-site');
    expect(checkReport(report!).find((c) => c.id === 'location')?.passed).toBe(true);
  });

  it('never replaces a location the scan already has', async () => {
    const scan = makeScan({ id: 'scan_gps', location: makeFix({ source: 'photo-exif' }) });
    await getRepositories().scans.put(scan);
    expect(await attachCurrentLocation(scan, SETTINGS)).toBe(scan);
    expect(fixSpy).not.toHaveBeenCalled();
  });

  it('passes on a location error without changing the scan', async () => {
    fixSpy.mockRejectedValue(new Error('Location permission is not granted.'));
    const scan = makeScan({ id: 'scan_upload', source: 'gallery', location: undefined });
    await getRepositories().scans.put(scan);
    await expect(attachCurrentLocation(scan, SETTINGS)).rejects.toThrow('permission');
    expect((await getRepositories().scans.get('scan_upload'))?.location).toBeUndefined();
  });
});
