import { z } from 'zod';

import { requestJson } from '@/api/http';
import { appConfig } from '@/constants/config';
import type { Address, Jurisdiction } from '@/models/location';
import type { LatLng } from '@/utils/geo';

/**
 * OpenStreetMap Nominatim reverse geocoding — fallback when the device
 * geocoder is unavailable. Usage policy: max 1 request/second, identify the
 * application, cache results. https://operations.osmfoundation.org/policies/nominatim/
 */
const addressSchema = z
  .object({
    house_number: z.string().optional(),
    road: z.string().optional(),
    neighbourhood: z.string().optional(),
    suburb: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    hamlet: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    'ISO3166-2-lvl4': z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional(),
  })
  .passthrough();

export const nominatimSchema = z.object({
  display_name: z.string().optional(),
  address: addressSchema.optional(),
  error: z.string().optional(),
});

export type NominatimResponse = z.infer<typeof nominatimSchema>;

export const parseNominatimAddress = (data: NominatimResponse): Address | undefined => {
  const a = data.address;
  if (!a || data.error) return undefined;
  const city = a.city ?? a.town ?? a.village ?? a.hamlet;
  const line1 = [a.house_number, a.road].filter(Boolean).join(' ') || undefined;
  const stateCode = a['ISO3166-2-lvl4']?.startsWith('US-') ? a['ISO3166-2-lvl4'].slice(3) : undefined;
  const formatted =
    [line1 ?? a.neighbourhood ?? a.suburb, city, [stateCode ?? a.state, a.postcode].filter(Boolean).join(' ')]
      .filter((p) => p && p.length > 0)
      .join(', ') ||
    data.display_name ||
    '';
  if (!formatted) return undefined;
  return {
    line1,
    street: a.road,
    city,
    county: a.county,
    state: stateCode ?? a.state,
    postalCode: a.postcode,
    country: a.country_code?.toUpperCase(),
    formatted,
    source: 'nominatim',
  };
};

export const approximateJurisdictionFromAddress = (
  addr: Address,
  source: Jurisdiction['source'],
  now = new Date(),
): Jurisdiction | undefined => {
  if (!addr.state && !addr.city) return undefined;
  return {
    country: addr.country ?? 'US',
    state: addr.state ? { name: addr.state, code: addr.state.length === 2 ? addr.state : undefined } : undefined,
    county: addr.county ? { name: addr.county } : undefined,
    place: addr.city ? { name: addr.city, incorporated: true } : undefined,
    // An address "city" is a postal name, not proof of municipal boundaries.
    responsibleLevel: 'unknown',
    displayName: [addr.city, addr.state].filter(Boolean).join(', '),
    source,
    confidence: 'approximate',
    resolvedAt: now.toISOString(),
  };
};

export const fetchNominatimAddress = async ({ latitude, longitude }: LatLng, signal?: AbortSignal): Promise<Address | undefined> => {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18` +
    `&lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`;
  const data = await requestJson(url, {
    schema: nominatimSchema,
    label: 'Nominatim',
    timeoutMs: 10_000,
    retries: 1,
    minIntervalMs: 1100,
    headers: { 'User-Agent': appConfig.userAgent, 'Accept-Language': 'en-US' },
    signal,
  });
  return parseNominatimAddress(data);
};
