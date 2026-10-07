const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in metres (haversine). */
export const distanceMeters = (a: LatLng, b: LatLng): number => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
};

export const isValidCoordinate = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180 &&
  !(lat === 0 && lng === 0);

/** Bounding box around a point, used for bbox-filtered API queries. */
export const boundsAround = (
  center: LatLng,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } => {
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.01, Math.cos(toRad(center.latitude)));
  return {
    minLat: center.latitude - dLat,
    maxLat: center.latitude + dLat,
    minLng: center.longitude - dLng,
    maxLng: center.longitude + dLng,
  };
};

/** Rough check that a point is in the US (incl. AK, HI, PR) — Census/US data only apply there. */
export const isLikelyUnitedStates = ({ latitude: lat, longitude: lng }: LatLng): boolean => {
  const contiguous = lat >= 24.3 && lat <= 49.5 && lng >= -125.0 && lng <= -66.8;
  const alaska = lat >= 51.0 && lat <= 71.6 && lng >= -180 && lng <= -129.9;
  const hawaii = lat >= 18.8 && lat <= 22.4 && lng >= -160.5 && lng <= -154.7;
  const puertoRico = lat >= 17.8 && lat <= 18.6 && lng >= -67.4 && lng <= -65.2;
  return contiguous || alaska || hawaii || puertoRico;
};

/** Rounds coordinates for cache keys (~11 m at 4 decimals). */
export const coordKey = ({ latitude, longitude }: LatLng, decimals = 4): string =>
  `${latitude.toFixed(decimals)},${longitude.toFixed(decimals)}`;

export const formatDistance = (meters: number, units: 'imperial' | 'metric'): string => {
  if (units === 'metric') {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
  }
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 5) * 5} ft`;
  const miles = meters / 1609.344;
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
};

export const formatAccuracy = (meters: number | null, units: 'imperial' | 'metric'): string => {
  if (meters === null || !Number.isFinite(meters)) return 'unknown';
  return units === 'metric' ? `±${Math.round(meters)} m` : `±${Math.round(meters * 3.28084)} ft`;
};

export const formatCoordinates = ({ latitude, longitude }: LatLng): string =>
  `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
