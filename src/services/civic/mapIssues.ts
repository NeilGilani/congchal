import type { FeatureCollection, Point } from 'geojson';

import { CATEGORY_INFO } from '@/constants/categories';
import type { PublicReport, PublicReportStatus } from '@/models/civic';
import type { CategoryGroup, IssueCategory, SeverityLevel } from '@/models/issue';
import type { Scan } from '@/models/scan';
import { distanceMeters, type LatLng } from '@/utils/geo';

import { effectiveCategory } from '../scan/enrichment';

export interface MapIssue {
  id: string;
  kind: 'local' | 'public';
  category?: IssueCategory;
  group: CategoryGroup;
  title: string;
  latitude: number;
  longitude: number;
  severity?: SeverityLevel;
  status: PublicReportStatus | 'reported' | 'scanned' | 'resolved' | 'reviewed';
  createdAt?: string;
  distanceMeters?: number;
  source: string;
  scanId?: string;
  isDemo?: boolean;
}

export const scanToMapIssue = (s: Scan, from?: LatLng): MapIssue | undefined => {
  if (!s.location) return undefined;
  const category = effectiveCategory(s);
  if (!category) return undefined;
  return {
    id: `local:${s.id}`,
    kind: 'local',
    category,
    group: CATEGORY_INFO[category].group,
    title: CATEGORY_INFO[category].label,
    latitude: s.location.latitude,
    longitude: s.location.longitude,
    severity: s.detections.find((d) => d.category === category)?.severity?.level,
    status: s.status,
    createdAt: s.createdAt,
    distanceMeters: from ? distanceMeters(from, s.location) : undefined,
    source: s.isDemo ? 'Demo scan' : 'Your scan',
    scanId: s.id,
    isDemo: s.isDemo,
  };
};

export const publicToMapIssue = (r: PublicReport, from?: LatLng): MapIssue => ({
  id: r.id,
  kind: 'public',
  category: r.mappedCategory,
  group: r.mappedCategory ? CATEGORY_INFO[r.mappedCategory].group : 'other',
  title: r.title,
  latitude: r.latitude,
  longitude: r.longitude,
  status: r.status,
  createdAt: r.createdAt,
  distanceMeters: from ? distanceMeters(from, r) : undefined,
  source: r.providerName,
});

export type SortKey = 'newest' | 'severity' | 'distance';
const SEV_RANK: Record<SeverityLevel, number> = { high: 3, moderate: 2, low: 1 };

export const filterAndSort = (issues: readonly MapIssue[], group: CategoryGroup | 'all', sort: SortKey): MapIssue[] => {
  const filtered = group === 'all' ? [...issues] : issues.filter((i) => i.group === group);
  return filtered.sort((a, b) => {
    if (sort === 'distance') return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
    if (sort === 'severity') {
      const d = (b.severity ? SEV_RANK[b.severity] : 0) - (a.severity ? SEV_RANK[a.severity] : 0);
      if (d !== 0) return d;
    }
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
};

export const isUnresolved = (i: MapIssue): boolean => i.status !== 'closed' && i.status !== 'resolved';

/** GeoJSON for the clustered map layer. */
export const toFeatureCollection = (issues: readonly MapIssue[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: issues.map((i) => ({
    type: 'Feature',
    id: i.id,
    geometry: { type: 'Point', coordinates: [i.longitude, i.latitude] },
    properties: {
      id: i.id,
      kind: i.kind,
      sev: i.severity ?? 'none',
      open: isUnresolved(i) ? 1 : 0,
    },
  })),
});
