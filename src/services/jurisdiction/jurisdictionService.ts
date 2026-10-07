import * as Location from 'expo-location';

import { describeNetworkError } from '@/api/http';
import type { Address, Jurisdiction } from '@/models/location';
import { TtlCache } from '@/storage/cache';
import { getDefaultStore } from '@/storage/kv';
import { coordKey, isLikelyUnitedStates, type LatLng } from '@/utils/geo';
import { log } from '@/utils/logger';

import { fetchCensusJurisdiction } from './census';
import { approximateJurisdictionFromAddress, fetchNominatimAddress } from './nominatim';

const DAY = 24 * 60 * 60 * 1000;

let jurisdictionCache: TtlCache<Jurisdiction> | undefined;
let addressCache: TtlCache<Address> | undefined;
const caches = () => {
  jurisdictionCache ??= new TtlCache<Jurisdiction>(getDefaultStore(), 'jurisdiction', 50);
  addressCache ??= new TtlCache<Address>(getDefaultStore(), 'address', 100);
  return { jurisdictionCache, addressCache };
};

export interface ResolvedPlace {
  address?: Address;
  jurisdiction?: Jurisdiction;
  /** Human-readable problems encountered (shown in Issue Detail / debug). */
  warnings: string[];
}

const fromDeviceGeocoder = async (point: LatLng): Promise<Address | undefined> => {
  try {
    const results = await Location.reverseGeocodeAsync(point);
    const r = results[0];
    if (!r) return undefined;
    const line1 = [r.streetNumber, r.street].filter(Boolean).join(' ') || r.name || undefined;
    const formatted = [line1, r.city ?? r.district, [r.region, r.postalCode].filter(Boolean).join(' ')]
      .filter((p) => p && p.length > 0)
      .join(', ');
    return {
      line1,
      street: r.street ?? undefined,
      city: r.city ?? undefined,
      county: r.subregion ?? undefined,
      state: r.region ?? undefined,
      postalCode: r.postalCode ?? undefined,
      country: r.isoCountryCode ?? undefined,
      formatted: r.formattedAddress ?? formatted,
      source: 'device-geocoder',
    };
  } catch (e) {
    log.warn('Jurisdiction', 'device geocoder failed', { error: e instanceof Error ? e.message : 'unknown' });
    return undefined;
  }
};

/**
 * latitude/longitude -> address + jurisdiction.
 *
 * 1. Address: device geocoder (Apple/Google platform service), falling back
 *    to OpenStreetMap Nominatim.
 * 2. Jurisdiction: US Census Bureau boundary lookup (authoritative). If that
 *    fails, an address-based guess labelled "approximate".
 * Results are cached per ~11 m cell, so revisiting a spot works offline.
 */
export const resolvePlace = async (point: LatLng, signal?: AbortSignal): Promise<ResolvedPlace> => {
  const { jurisdictionCache: jc, addressCache: ac } = caches();
  const key = coordKey(point, 4);
  const warnings: string[] = [];

  let address = await ac.get(key);
  if (!address) {
    address = await fromDeviceGeocoder(point);
    if (!address) {
      try {
        address = await fetchNominatimAddress(point, signal);
      } catch (e) {
        warnings.push(`Address lookup failed: ${describeNetworkError(e)}`);
      }
    }
    if (address) await ac.set(key, address, 30 * DAY);
  }

  let jurisdiction = await jc.get(key);
  if (!jurisdiction) {
    if (isLikelyUnitedStates(point)) {
      const started = Date.now();
      try {
        jurisdiction = await fetchCensusJurisdiction(point, signal);
        log.info('Jurisdiction', 'census', { ok: Boolean(jurisdiction), latency: Date.now() - started });
        if (jurisdiction) await jc.set(key, jurisdiction, 90 * DAY);
      } catch (e) {
        warnings.push(`Official boundary lookup failed: ${describeNetworkError(e)}`);
        log.warn('Jurisdiction', 'census failed', { latency: Date.now() - started });
      }
    } else {
      warnings.push('Jurisdiction lookup currently supports the United States only.');
    }
    if (!jurisdiction && address) {
      jurisdiction = approximateJurisdictionFromAddress(address, address.source);
    }
  }
  return { address, jurisdiction, warnings };
};
