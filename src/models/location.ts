export interface GeoFix {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy radius in metres (68% confidence, as reported by the OS). */
  accuracy: number | null;
  altitude?: number | null;
  timestamp: string;
  source: 'gps' | 'last-known' | 'photo-exif' | 'demo';
}

export type LocationQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface Address {
  line1?: string;
  street?: string;
  city?: string;
  county?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  formatted: string;
  source: 'device-geocoder' | 'nominatim' | 'census';
}

export interface JurisdictionUnit {
  name: string;
  /** Census GEOID / FIPS code where available. */
  geoid?: string;
}

export interface Jurisdiction {
  country: string;
  state?: JurisdictionUnit & { code?: string };
  county?: JurisdictionUnit;
  /** Incorporated place (city/town/village) or census-designated place. */
  place?: JurisdictionUnit & { incorporated: boolean };
  /** Government most likely responsible for local streets at this point. */
  responsibleLevel: 'city' | 'county' | 'unknown';
  displayName: string;
  source: 'census' | 'device-geocoder' | 'nominatim';
  /** `authoritative` = Census boundary lookup; `approximate` = address-based guess. */
  confidence: 'authoritative' | 'approximate';
  resolvedAt: string;
}

/** Road context from OpenStreetMap around the point (optional enrichment). */
export interface RoadContext {
  nearestRoadName?: string;
  roadClass?: string;
  /** e.g. "CA 82", "US 101" for state/federal routes. */
  routeRef?: string;
  isStateRoute: boolean;
  hasSidewalkTag?: boolean;
  distanceMeters?: number;
  source: 'openstreetmap';
  fetchedAt: string;
}
