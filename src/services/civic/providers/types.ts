import type { PublicReport } from '@/models/civic';
import type { Jurisdiction } from '@/models/location';
import type { LatLng } from '@/utils/geo';

export interface CivicDataProvider {
  id: string;
  name: string;
  coverage: string;
  url: string;
  /** Whether this provider can have data for the jurisdiction. */
  appliesTo(jurisdiction: Jurisdiction | undefined, point: LatLng): boolean;
  fetchNearby(point: LatLng, radiusMeters: number, signal?: AbortSignal): Promise<PublicReport[]>;
}
