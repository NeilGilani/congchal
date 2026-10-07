import { geoFixFromExif } from '@/utils/exif';

const FALLBACK = '2026-10-06T17:00:00.000Z';

describe('geoFixFromExif', () => {
  it('reads Android-style flat GPS tags and applies the S/W hemisphere refs', () => {
    // Sydney Opera House as reported by expo-image-picker on Android.
    const fix = geoFixFromExif(
      {
        GPSLatitude: 33.856784,
        GPSLatitudeRef: 'S',
        GPSLongitude: 151.215297,
        GPSLongitudeRef: 'E',
        GPSAltitude: 4,
        DateTimeOriginal: '2026:10:06 14:23:11',
        Make: 'Google',
        Model: 'Pixel 8',
      },
      FALLBACK,
    );
    expect(fix).toEqual({
      latitude: -33.856784,
      longitude: 151.215297,
      accuracy: null,
      timestamp: new Date('2026-10-06T14:23:11').toISOString(),
      source: 'photo-exif',
    });
  });

  it('reads iOS nested {GPS} metadata including the horizontal error', () => {
    const fix = geoFixFromExif(
      {
        '{GPS}': {
          Latitude: 37.3382,
          LatitudeRef: 'N',
          Longitude: 121.8863,
          LongitudeRef: 'W',
          HPositioningError: 4.7,
          Altitude: 26.3,
        },
        '{Exif}': { LensModel: 'iPhone 15 back camera' },
      },
      FALLBACK,
    );
    expect(fix?.latitude).toBe(37.3382);
    expect(fix?.longitude).toBe(-121.8863);
    expect(fix?.accuracy).toBe(4.7);
    expect(fix?.timestamp).toBe(FALLBACK);
  });

  it('converts degree/minute/second arrays and numeric strings', () => {
    const fix = geoFixFromExif(
      { GPSLatitude: [37, 20, 17.52], GPSLatitudeRef: 'N', GPSLongitude: ['121', '53', '10.68'], GPSLongitudeRef: 'w' },
      FALLBACK,
    );
    expect(fix?.latitude).toBeCloseTo(37.3382, 6);
    expect(fix?.longitude).toBeCloseTo(-121.8863, 6);
    expect(geoFixFromExif({ GPSLatitude: '40.7128', GPSLongitude: '-74.0060' }, FALLBACK)?.longitude).toBeCloseTo(-74.006, 6);
  });

  it('keeps an already-negative value negative with a W ref', () => {
    expect(geoFixFromExif({ GPSLatitude: 37.3382, GPSLongitude: -121.8863, GPSLongitudeRef: 'W' }, FALLBACK)?.longitude).toBe(-121.8863);
  });

  it('returns undefined when the photo has no GPS position', () => {
    expect(geoFixFromExif(null, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif(undefined, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif({ Make: 'Apple', DateTimeOriginal: '2026:10:06 14:23:11' }, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif({ GPSLatitude: 37.3382 }, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif({ '{GPS}': null, GPSLongitude: 1 }, FALLBACK)).toBeUndefined();
  });

  it('rejects impossible or placeholder coordinates', () => {
    expect(geoFixFromExif({ GPSLatitude: 0, GPSLongitude: 0 }, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif({ GPSLatitude: 123, GPSLongitude: 10 }, FALLBACK)).toBeUndefined();
    expect(geoFixFromExif({ GPSLatitude: 'north', GPSLongitude: 10 }, FALLBACK)).toBeUndefined();
  });

  it('falls back to the given time when DateTimeOriginal is unreadable', () => {
    const fix = geoFixFromExif({ GPSLatitude: 37.3382, GPSLongitude: -121.8863, DateTimeOriginal: '0000:00:00 00:00:00' }, FALLBACK);
    expect(fix?.timestamp).toBe(FALLBACK);
  });
});
