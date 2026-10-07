import * as Location from 'expo-location';

import type { GeoFix } from '@/models/location';
import { isValidCoordinate } from '@/utils/geo';
import { log } from '@/utils/logger';

import { betterFix, classifyAccuracy, isFixFresh } from './locationQuality';

export type LocationPermission = 'granted' | 'denied' | 'undetermined' | 'blocked';

export class LocationUnavailableError extends Error {
  constructor(
    readonly reason: 'permission' | 'services_off' | 'timeout' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

const toFix = (o: Location.LocationObject, source: GeoFix['source']): GeoFix | undefined => {
  const { latitude, longitude, accuracy, altitude } = o.coords;
  if (!isValidCoordinate(latitude, longitude)) return undefined;
  return {
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    altitude: altitude ?? null,
    timestamp: new Date(o.timestamp).toISOString(),
    source,
  };
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);

/**
 * Foreground-only location. CivicLens never requests background location.
 * While the camera is open we keep a low-power watch running so a good fix
 * is usually ready the moment the user taps Scan.
 */
class LocationServiceImpl {
  private latest: GeoFix | undefined;
  private watcher: Location.LocationSubscription | undefined;
  private watchers = 0;
  private listeners = new Set<(fix: GeoFix) => void>();

  async getPermission(): Promise<LocationPermission> {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) return 'granted';
    if (p.status === Location.PermissionStatus.UNDETERMINED) return 'undetermined';
    return p.canAskAgain ? 'denied' : 'blocked';
  }

  async requestPermission(): Promise<LocationPermission> {
    const p = await Location.requestForegroundPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'denied' : 'blocked';
  }

  latestFix(): GeoFix | undefined {
    return this.latest && isFixFresh(this.latest) ? this.latest : undefined;
  }

  subscribe(listener: (fix: GeoFix) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private accept(fix: GeoFix | undefined): GeoFix | undefined {
    if (!fix) return this.latest;
    this.latest = betterFix(this.latest && isFixFresh(this.latest) ? this.latest : undefined, fix);
    this.listeners.forEach((l) => l(this.latest as GeoFix));
    return this.latest;
  }

  /** Starts (ref-counted) high-accuracy updates while a screen needs them. */
  async startWatching(): Promise<() => void> {
    this.watchers++;
    if (!this.watcher && (await this.getPermission()) === 'granted') {
      try {
        this.watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 2000 },
          (o) => {
            const fix = this.accept(toFix(o, 'gps'));
            if (fix) log.info('Location', 'fix', { accuracy: Math.round(fix.accuracy ?? -1), quality: classifyAccuracy(fix.accuracy) });
          },
          (reason) => log.warn('Location', 'watch error', { reason }),
        );
      } catch (e) {
        log.warn('Location', 'watch failed', { error: e instanceof Error ? e.message : 'unknown' });
      }
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0 && this.watcher) {
        this.watcher.remove();
        this.watcher = undefined;
      }
    };
  }

  /**
   * Best available current fix. Uses the running watch if it is fresh,
   * otherwise asks the OS (bounded by `timeoutMs`), and finally falls back to
   * a recent last-known position, which is labelled as such.
   */
  async getCurrentFix(timeoutMs = 8000): Promise<GeoFix> {
    const permission = await this.getPermission();
    if (permission !== 'granted') {
      throw new LocationUnavailableError('permission', 'Location permission is not granted.');
    }
    const cached = this.latestFix();
    if (cached && classifyAccuracy(cached.accuracy) === 'good') return cached;

    if (!(await Location.hasServicesEnabledAsync())) {
      throw new LocationUnavailableError('services_off', 'Location services are turned off.');
    }
    try {
      const o = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeoutMs);
      const fix = o ? this.accept(toFix(o, 'gps')) : undefined;
      if (fix) return fix;
    } catch (e) {
      log.warn('Location', 'current position failed', { error: e instanceof Error ? e.message : 'unknown' });
    }
    if (cached) return cached;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000, requiredAccuracy: 200 });
    const lastFix = last ? toFix(last, 'last-known') : undefined;
    if (lastFix) return lastFix;
    throw new LocationUnavailableError('timeout', "Couldn't get a location fix. Move outdoors and try again.");
  }
}

export const LocationService = new LocationServiceImpl();
