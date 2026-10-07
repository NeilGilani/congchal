import { useCallback, useEffect, useState } from 'react';

import type { GeoFix, LocationQuality } from '@/models/location';
import { classifyAccuracy } from '@/services/location/locationQuality';
import { LocationService, type LocationPermission } from '@/services/location/locationService';

export interface LocationState {
  permission: LocationPermission | 'unknown';
  fix?: GeoFix;
  quality: LocationQuality;
  request: () => Promise<LocationPermission>;
}

/** Foreground location while a screen is mounted (only after permission is granted). */
export const useLocation = (active: boolean, enabled = true): LocationState => {
  const [permission, setPermission] = useState<LocationPermission | 'unknown'>('unknown');
  const [fix, setFix] = useState<GeoFix | undefined>(LocationService.latestFix());

  useEffect(() => {
    let alive = true;
    void LocationService.getPermission()
      .then((p) => alive && setPermission(p))
      .catch(() => alive && setPermission('denied'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !enabled || permission !== 'granted') return;
    let stop: (() => void) | undefined;
    let alive = true;
    const unsub = LocationService.subscribe((f) => alive && setFix(f));
    void LocationService.startWatching().then((s) => {
      if (alive) stop = s;
      else s();
    });
    return () => {
      alive = false;
      unsub();
      stop?.();
    };
  }, [active, enabled, permission]);

  const request = useCallback(async () => {
    const p = await LocationService.requestPermission();
    setPermission(p);
    return p;
  }, []);

  return { permission, fix, quality: classifyAccuracy(fix?.accuracy), request };
};
