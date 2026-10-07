import {
  boundsAround,
  coordKey,
  distanceMeters,
  formatAccuracy,
  formatCoordinates,
  formatDistance,
  isLikelyUnitedStates,
  isValidCoordinate,
} from '@/utils/geo';

const sanJoseCityHall = { latitude: 37.3382, longitude: -121.8863 };
const sacramentoCapitol = { latitude: 38.5767, longitude: -121.4934 };
const jfk = { latitude: 40.6413, longitude: -73.7781 };
const lax = { latitude: 33.9416, longitude: -118.4085 };

describe('distanceMeters', () => {
  // Reference values computed independently with Python (haversine, R = 6,371,008.8 m).
  it('matches independently computed great-circle distances', () => {
    expect(distanceMeters(sanJoseCityHall, sacramentoCapitol)).toBeCloseTo(141_957.44, 1);
    expect(distanceMeters(jfk, lax)).toBeCloseTo(3_974_341.69, 1);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111_195.08, 1);
  });

  it('is zero for the same point and symmetric', () => {
    expect(distanceMeters(sanJoseCityHall, sanJoseCityHall)).toBe(0);
    expect(distanceMeters(jfk, lax)).toBeCloseTo(distanceMeters(lax, jfk), 6);
  });

  it('stays finite for antipodal points (half the circumference)', () => {
    expect(distanceMeters({ latitude: 10, longitude: 20 }, { latitude: -10, longitude: -160 })).toBeCloseTo(20_015_114.25, 0);
  });
});

describe('isValidCoordinate', () => {
  it('accepts real coordinates, including the range limits', () => {
    expect(isValidCoordinate(37.3382, -121.8863)).toBe(true);
    expect(isValidCoordinate(-90, 180)).toBe(true);
  });

  it.each([
    [0, 0],
    [91, 0],
    [0, -181],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
    ['37.3', '-121.8'],
    [null, undefined],
  ])('rejects (%p, %p)', (lat, lng) => {
    expect(isValidCoordinate(lat, lng)).toBe(false);
  });
});

describe('boundsAround', () => {
  it('spans the radius in every direction', () => {
    const b = boundsAround(sanJoseCityHall, 150);
    expect(distanceMeters(sanJoseCityHall, { latitude: b.maxLat, longitude: sanJoseCityHall.longitude })).toBeCloseTo(150, 3);
    expect(distanceMeters(sanJoseCityHall, { latitude: b.minLat, longitude: sanJoseCityHall.longitude })).toBeCloseTo(150, 3);
    // Longitude degrees shrink with latitude, so the east/west extent is wider in degrees.
    expect(b.maxLng - sanJoseCityHall.longitude).toBeGreaterThan(b.maxLat - sanJoseCityHall.latitude);
    expect(distanceMeters(sanJoseCityHall, { latitude: sanJoseCityHall.latitude, longitude: b.maxLng })).toBeCloseTo(150, 0);
  });
});

describe('isLikelyUnitedStates', () => {
  it.each([
    ['San José', sanJoseCityHall, true],
    ['Honolulu', { latitude: 21.3069, longitude: -157.8583 }, true],
    ['Anchorage', { latitude: 61.2181, longitude: -149.9003 }, true],
    ['San Juan, PR', { latitude: 18.4655, longitude: -66.1057 }, true],
    ['London', { latitude: 51.5072, longitude: -0.1276 }, false],
    ['Mexico City', { latitude: 19.4326, longitude: -99.1332 }, false],
  ])('%s -> %s', (_name, point, expected) => {
    expect(isLikelyUnitedStates(point)).toBe(expected);
  });
});

describe('formatting', () => {
  it('rounds cache keys to about 11 m', () => {
    expect(coordKey(sanJoseCityHall)).toBe('37.3382,-121.8863');
    expect(coordKey({ latitude: 37.33824, longitude: -121.88626 })).toBe(coordKey(sanJoseCityHall));
    expect(coordKey(sanJoseCityHall, 2)).toBe('37.34,-121.89');
  });

  it('formats distances in imperial and metric units', () => {
    expect(formatDistance(42, 'imperial')).toBe('140 ft');
    expect(formatDistance(2000, 'imperial')).toBe('1.2 mi');
    expect(formatDistance(20_000, 'imperial')).toBe('12 mi');
    expect(formatDistance(850, 'metric')).toBe('850 m');
    expect(formatDistance(1500, 'metric')).toBe('1.5 km');
    expect(formatDistance(12_345, 'metric')).toBe('12 km');
  });

  it('formats GPS accuracy and coordinates', () => {
    expect(formatAccuracy(8, 'imperial')).toBe('±26 ft');
    expect(formatAccuracy(8, 'metric')).toBe('±8 m');
    expect(formatAccuracy(null, 'metric')).toBe('unknown');
    expect(formatAccuracy(Number.NaN, 'metric')).toBe('unknown');
    expect(formatCoordinates(sanJoseCityHall)).toBe('37.33820, -121.88630');
  });
});
