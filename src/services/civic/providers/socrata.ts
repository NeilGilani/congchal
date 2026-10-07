import { z } from 'zod';

import { requestJson } from '@/api/http';
import { appConfig } from '@/constants/config';
import type { PublicReport, PublicReportStatus } from '@/models/civic';
import { isValidCoordinate, type LatLng } from '@/utils/geo';

import { mapRawCategory } from '../categoryMapping';
import type { CivicDataProvider } from './types';

/**
 * City 311 service-request datasets published on Socrata open-data portals
 * (SODA API). Queried with SoQL `within_circle` around the user.
 */
interface SocrataDataset {
  id: string;
  name: string;
  /** Census place GEOID of the city. */
  placeGeoid: string;
  domain: string;
  dataset: string;
  geoField: string;
  createdField: string;
  select: readonly string[];
  toReport(row: Record<string, unknown>): PublicReport | undefined;
  portalUrl: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const statusOf = (raw: string | undefined): PublicReportStatus => {
  const s = (raw ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (/closed|completed|resolved|cancel/.test(s)) return 'closed';
  if (/progress|assigned|started|acknowledged|pending/.test(s)) return 'acknowledged';
  if (/open|new/.test(s)) return 'open';
  return 'unknown';
};

export const SOCRATA_DATASETS: readonly SocrataDataset[] = [
  {
    id: 'nyc311',
    name: 'NYC 311 Service Requests',
    placeGeoid: '3651000',
    domain: 'data.cityofnewyork.us',
    dataset: 'erm2-nwe9',
    geoField: 'location',
    createdField: 'created_date',
    select: ['unique_key', 'created_date', 'closed_date', 'complaint_type', 'descriptor', 'incident_address', 'status', 'latitude', 'longitude'],
    portalUrl: 'https://portal.311.nyc.gov/',
    toReport(r) {
      const lat = num(r.latitude);
      const lng = num(r.longitude);
      const key = str(r.unique_key);
      if (!key || !isValidCoordinate(lat, lng)) return undefined;
      const type = str(r.complaint_type);
      const desc = str(r.descriptor);
      return {
        id: `nyc311:${key}`,
        provider: 'nyc311',
        providerName: 'NYC 311',
        title: [type, desc].filter(Boolean).join(' – ') || 'Service request',
        rawCategory: type,
        mappedCategory: mapRawCategory(desc, type),
        status: statusOf(str(r.status)),
        rawStatus: str(r.status),
        latitude: lat as number,
        longitude: lng as number,
        address: str(r.incident_address),
        createdAt: str(r.created_date),
      };
    },
  },
  {
    id: 'sf311',
    name: 'SF 311 Cases',
    placeGeoid: '0667000',
    domain: 'data.sfgov.org',
    dataset: 'vw6y-z8j6',
    geoField: 'point',
    createdField: 'requested_datetime',
    select: ['service_request_id', 'requested_datetime', 'updated_datetime', 'status_description', 'service_name', 'service_subtype', 'address', 'lat', 'long'],
    portalUrl: 'https://www.sf.gov/topics/311-online-services',
    toReport(r) {
      const lat = num(r.lat);
      const lng = num(r.long);
      const key = str(r.service_request_id);
      if (!key || !isValidCoordinate(lat, lng)) return undefined;
      const name = str(r.service_name);
      const sub = str(r.service_subtype);
      return {
        id: `sf311:${key}`,
        provider: 'sf311',
        providerName: 'SF 311',
        title: [name, sub?.replace(/_/g, ' ')].filter(Boolean).join(' – ') || 'Service request',
        rawCategory: name,
        mappedCategory: mapRawCategory(sub, name),
        status: statusOf(str(r.status_description)),
        rawStatus: str(r.status_description),
        latitude: lat as number,
        longitude: lng as number,
        address: str(r.address),
        createdAt: str(r.requested_datetime),
        updatedAt: str(r.updated_datetime),
      };
    },
  },
  {
    id: 'chi311',
    name: 'Chicago 311 Service Requests',
    placeGeoid: '1714000',
    domain: 'data.cityofchicago.org',
    dataset: 'v6vf-nfxy',
    geoField: 'location',
    createdField: 'created_date',
    select: ['sr_number', 'sr_type', 'status', 'created_date', 'closed_date', 'street_address', 'latitude', 'longitude'],
    portalUrl: 'https://311.chicago.gov/',
    toReport(r) {
      const lat = num(r.latitude);
      const lng = num(r.longitude);
      const key = str(r.sr_number);
      if (!key || !isValidCoordinate(lat, lng)) return undefined;
      const type = str(r.sr_type);
      return {
        id: `chi311:${key}`,
        provider: 'chi311',
        providerName: 'Chicago 311',
        title: type ?? 'Service request',
        rawCategory: type,
        mappedCategory: mapRawCategory(type),
        status: statusOf(str(r.status)),
        rawStatus: str(r.status),
        latitude: lat as number,
        longitude: lng as number,
        address: str(r.street_address),
        createdAt: str(r.created_date),
      };
    },
  },
];

export const socrataRowsSchema = z.array(z.record(z.string(), z.unknown()));

export const buildSocrataUrl = (ds: SocrataDataset, point: LatLng, radiusMeters: number, sinceIso: string): string => {
  const where =
    `within_circle(${ds.geoField}, ${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}, ${Math.round(radiusMeters)})` +
    ` AND ${ds.createdField} > '${sinceIso.slice(0, 19)}'`;
  const params = [
    `$select=${encodeURIComponent(ds.select.join(','))}`,
    `$where=${encodeURIComponent(where)}`,
    `$order=${encodeURIComponent(`${ds.createdField} DESC`)}`,
    '$limit=200',
  ];
  return `https://${ds.domain}/resource/${ds.dataset}.json?${params.join('&')}`;
};

export const socrataProviders: CivicDataProvider[] = SOCRATA_DATASETS.map((ds) => ({
  id: ds.id,
  name: ds.name,
  coverage: `${ds.name} (official open data)`,
  url: `https://${ds.domain}/d/${ds.dataset}`,
  appliesTo: (j) => j?.place?.geoid === ds.placeGeoid,
  async fetchNearby(point, radiusMeters, signal) {
    const since = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
    const headers: Record<string, string> = { 'User-Agent': appConfig.userAgent };
    if (appConfig.socrataAppToken) headers['X-App-Token'] = appConfig.socrataAppToken;
    const rows = await requestJson(buildSocrataUrl(ds, point, radiusMeters, since), {
      schema: socrataRowsSchema,
      label: ds.name,
      timeoutMs: 15_000,
      retries: 1,
      minIntervalMs: 300,
      headers,
      signal,
    });
    return rows.flatMap((r) => {
      const rep = ds.toReport(r);
      return rep ? [rep] : [];
    });
  },
}));
