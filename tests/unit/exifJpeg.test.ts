import fs from 'node:fs';
import path from 'node:path';

import { geoFixFromExif } from '@/utils/exif';
import { readJpegExif } from '@/utils/exifJpeg';

const FALLBACK = '2026-10-07T12:00:00.000Z';

/** Fixtures were written by Pillow (an independent EXIF writer), see the commit that added them. */
const fixture = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'exif', name)));

/**
 * Builds a JPEG whose APP1 segment holds a TIFF block with an Exif IFD
 * (DateTimeOriginal) and a GPS IFD, laid out by hand so tests can corrupt
 * specific fields.
 */
const buildJpeg = (
  opts: {
    little?: boolean;
    latDen?: number;
    gpsPointer?: number;
    gpsCount?: number;
    app0?: boolean;
    exifAfterScan?: boolean;
  } = {},
): Uint8Array => {
  const little = opts.little ?? true;
  const t = new DataView(new ArrayBuffer(198));
  const u16 = (o: number, v: number) => t.setUint16(o, v, little);
  const u32 = (o: number, v: number) => t.setUint32(o, v, little);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => t.setUint8(o + i, c.charCodeAt(0)));
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  t.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  u16(2, 42);
  u32(4, 8);
  // IFD0 at 8: Exif pointer, GPS pointer.
  u16(8, 2);
  entry(10, 0x8769, 4, 1, 38);
  entry(22, 0x8825, 4, 1, opts.gpsPointer ?? 76);
  u32(34, 0);
  // Exif IFD at 38: DateTimeOriginal -> 20 bytes at 56.
  u16(38, 1);
  entry(40, 0x9003, 2, 20, 56);
  u32(52, 0);
  ascii(56, '2026:10:05 09:12:33');
  // GPS IFD at 76.
  u16(76, opts.gpsCount ?? 5);
  entry(78, 1, 2, 2, 0);
  ascii(86, 'N');
  entry(90, 2, 5, 3, 142);
  entry(102, 3, 2, 2, 0);
  ascii(110, 'W');
  entry(114, 4, 5, 3, 166);
  entry(126, 0x1f, 5, 1, 190);
  u32(138, 0);
  const rational = (o: number, num: number, den: number) => {
    u32(o, num);
    u32(o + 4, den);
  };
  rational(142, 37, opts.latDen ?? 1);
  rational(150, 20, 1);
  rational(158, 1550, 100);
  rational(166, 121, 1);
  rational(174, 53, 1);
  rational(182, 1020, 100);
  rational(190, 5, 1);

  const tiff = new Uint8Array(t.buffer);
  const app1 = [0xff, 0xe1, ...[(tiff.length + 8) >> 8, (tiff.length + 8) & 0xff], 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const scan = [0xff, 0xda, 0x00, 0x02, 0x12, 0x34];
  const parts = opts.exifAfterScan ? [[0xff, 0xd8], scan, app1] : [[0xff, 0xd8], opts.app0 ? app0 : [], app1, scan];
  return new Uint8Array([...parts.flat(), 0xff, 0xd9]);
};

/** Deterministic pseudo-random generator so the fuzz test is reproducible. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('readJpegExif', () => {
  it('reads GPS, accuracy and capture time from a little-endian file written by Pillow', () => {
    const exif = readJpegExif(fixture('gps-little-endian.jpg'));
    expect(exif?.GPSLatitude).toEqual([37, 20, 15.5]);
    expect(exif?.GPSLongitude).toEqual([121, 53, 10.2]);
    expect(exif?.GPSLatitudeRef).toBe('N');
    expect(exif?.GPSLongitudeRef).toBe('W');
    expect(exif?.GPSHPositioningError).toBe(5);
    expect(exif?.DateTimeOriginal).toBe('2026:10:05 09:12:33');

    const fix = geoFixFromExif(exif, FALLBACK);
    expect(fix?.latitude).toBeCloseTo(37 + 20 / 60 + 15.5 / 3600, 9);
    expect(fix?.longitude).toBeCloseTo(-(121 + 53 / 60 + 10.2 / 3600), 9);
    expect(fix?.accuracy).toBe(5);
    expect(fix?.source).toBe('photo-exif');
    expect(fix?.timestamp).toBe(new Date('2026-10-05T09:12:33').toISOString());
  });

  it('reads a big-endian file and applies the S/E hemispheres', () => {
    const fix = geoFixFromExif(readJpegExif(fixture('gps-big-endian.jpg')), FALLBACK);
    expect(fix?.latitude).toBeCloseTo(-(33 + 51 / 60 + 24.4 / 3600), 9);
    expect(fix?.longitude).toBeCloseTo(151 + 12 / 60 + 55.1 / 3600, 9);
    expect(fix?.accuracy).toBeNull();
  });

  it('reports no location for a photo without GPS data, but still reads the capture time', () => {
    const exif = readJpegExif(fixture('no-gps.jpg'));
    expect(exif?.DateTimeOriginal).toBe('2026:10:01 08:00:00');
    expect(exif?.GPSLatitude).toBeUndefined();
    expect(geoFixFromExif(exif, FALLBACK)).toBeUndefined();
  });

  it('reads both byte orders of a hand-built file identically', () => {
    const le = readJpegExif(buildJpeg({ little: true }));
    const be = readJpegExif(buildJpeg({ little: false }));
    expect(le).toEqual(be);
    expect(le?.GPSLatitude).toEqual([37, 20, 15.5]);
  });

  it('finds the EXIF segment after a JFIF APP0 header', () => {
    expect(readJpegExif(buildJpeg({ app0: true }))?.GPSLongitude).toEqual([121, 53, 10.2]);
  });

  it('ignores anything after the start of image data', () => {
    expect(readJpegExif(buildJpeg({ exifAfterScan: true }))).toBeUndefined();
  });

  it('rejects a coordinate with a zero denominator instead of dividing by zero', () => {
    const exif = readJpegExif(buildJpeg({ latDen: 0 }));
    expect(exif?.GPSLatitude).toBeUndefined();
    expect(exif?.GPSLongitude).toBeUndefined();
    expect(geoFixFromExif(exif, FALLBACK)).toBeUndefined();
  });

  it('survives a GPS pointer past the end of the data and an absurd entry count', () => {
    expect(readJpegExif(buildJpeg({ gpsPointer: 0xfffffff0 }))?.GPSLatitude).toBeUndefined();
    expect(readJpegExif(buildJpeg({ gpsCount: 0xffff }))?.GPSLatitude).toBeUndefined();
  });

  it('returns undefined for files that are not JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(readJpegExif(png)).toBeUndefined();
    expect(readJpegExif(new Uint8Array())).toBeUndefined();
  });

  it('never throws on truncated files', () => {
    const full = fixture('gps-little-endian.jpg');
    for (let n = 0; n < full.length; n++) {
      expect(() => readJpegExif(full.subarray(0, n))).not.toThrow();
    }
  });

  it('never throws or returns a non-finite coordinate on randomly corrupted files', () => {
    const random = rng(7);
    const base = fixture('gps-little-endian.jpg');
    for (let i = 0; i < 2000; i++) {
      const bytes = base.slice();
      const flips = 1 + Math.floor(random() * 8);
      for (let f = 0; f < flips; f++) bytes[Math.floor(random() * 300)] = Math.floor(random() * 256);
      const exif = readJpegExif(bytes);
      for (const v of [...(exif?.GPSLatitude ?? []), ...(exif?.GPSLongitude ?? [])]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
