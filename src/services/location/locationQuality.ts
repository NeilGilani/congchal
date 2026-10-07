import type { GeoFix, LocationQuality } from '@/models/location';

/** Accuracy bands (metres). 15 m ≈ a few house fronts; 50 m ≈ half a block. */
export const ACCURACY_GOOD_M = 15;
export const ACCURACY_FAIR_M = 50;
/** A fix older than this is not used for a new report. */
export const MAX_FIX_AGE_MS = 2 * 60 * 1000;

export const classifyAccuracy = (accuracy: number | null | undefined): LocationQuality => {
  if (accuracy === null || accuracy === undefined || !Number.isFinite(accuracy) || accuracy <= 0) return 'unknown';
  if (accuracy <= ACCURACY_GOOD_M) return 'good';
  if (accuracy <= ACCURACY_FAIR_M) return 'fair';
  return 'poor';
};

export const locationQualityMessage = (q: LocationQuality): string | undefined => {
  switch (q) {
    case 'good':
      return undefined;
    case 'fair':
      return 'Location is approximate. Waiting a few seconds outdoors usually improves it.';
    case 'poor':
      return 'Location accuracy is currently low. Move outdoors or wait for GPS to improve.';
    case 'unknown':
      return "The device didn't report how accurate this location is.";
  }
};

export const isFixFresh = (fix: GeoFix, now = Date.now()): boolean =>
  now - new Date(fix.timestamp).getTime() <= MAX_FIX_AGE_MS;

/** Keeps the better of two fixes (fresher wins unless it is much less accurate). */
export const betterFix = (a: GeoFix | undefined, b: GeoFix): GeoFix => {
  if (!a) return b;
  const accA = a.accuracy ?? Infinity;
  const accB = b.accuracy ?? Infinity;
  const ageGap = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  if (ageGap > 30_000) return b;
  return accB <= accA * 1.5 ? b : a;
};
