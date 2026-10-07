import type { GeoFix } from '@/models/location';

import { isValidCoordinate } from './geo';

type Exif = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

/** EXIF GPS can be decimal degrees or [deg, min, sec]. */
const toDegrees = (v: unknown): number | undefined => {
  if (Array.isArray(v) && v.length >= 1) {
    const parts = v.slice(0, 3).map(num);
    // Missing minutes/seconds default to 0, but a value that fails to parse
    // invalidates the coordinate.
    if (parts.some((p) => p === undefined)) return undefined;
    const [d = 0, m = 0, s = 0] = parts as number[];
    return d + m / 60 + s / 3600;
  }
  return num(v);
};

/**
 * Reads the photo's own GPS position from EXIF (gallery photos). The user's
 * *current* location is never attached to a gallery photo, because the photo
 * may have been taken somewhere else.
 */
export const geoFixFromExif = (exif: Exif | null | undefined, fallbackIso: string): GeoFix | undefined => {
  if (!exif) return undefined;
  const nested = typeof exif['{GPS}'] === 'object' && exif['{GPS}'] !== null ? (exif['{GPS}'] as Exif) : undefined;
  const g = (k: string): unknown => exif[`GPS${k}`] ?? nested?.[k];
  let lat = toDegrees(g('Latitude'));
  let lng = toDegrees(g('Longitude'));
  if (lat === undefined || lng === undefined) return undefined;
  if (String(g('LatitudeRef') ?? '').toUpperCase() === 'S') lat = -Math.abs(lat);
  if (String(g('LongitudeRef') ?? '').toUpperCase() === 'W') lng = -Math.abs(lng);
  if (!isValidCoordinate(lat, lng)) return undefined;
  const err = num(g('HPositioningError'));
  const stamp = typeof exif.DateTimeOriginal === 'string' ? exif.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') : undefined;
  const ts = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp).toISOString() : fallbackIso;
  return { latitude: lat, longitude: lng, accuracy: err ?? null, timestamp: ts, source: 'photo-exif' };
};
