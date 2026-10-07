import { z } from 'zod';

import { requestJson } from '@/api/http';
import { appConfig } from '@/constants/config';
import type { PublicReport, PublicReportStatus } from '@/models/civic';
import { boundsAround, isValidCoordinate, type LatLng } from '@/utils/geo';
import { safeHttpUrl } from '@/utils/sanitize';

import { mapRawCategory } from '../categoryMapping';
import type { RequestTypeHint } from '../departmentService';
import type { CivicDataProvider } from './types';

/**
 * SeeClickFix (CivicPlus) public API v2. Hundreds of US cities and counties
 * use SeeClickFix as their official request system; reading public issues
 * requires no key. https://dev.seeclickfix.com/
 */
const BASE = 'https://seeclickfix.com/api/v2';

const issueSchema = z
  .object({
    id: z.number(),
    status: z.string().optional(),
    summary: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    address: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    html_url: z.string().nullable().optional(),
    request_type: z
      .object({ title: z.string().nullable().optional(), organization: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    media: z
      .object({
        image_square_100x100: z.string().nullable().optional(),
        representative_image_url: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const seeClickFixIssuesSchema = z.object({ issues: z.array(issueSchema) }).passthrough();

export const seeClickFixRequestTypesSchema = z
  .object({
    request_types: z.array(
      z
        .object({
          title: z.string(),
          organization: z.string().nullable().optional(),
          url: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const STATUS: Record<string, PublicReportStatus> = {
  open: 'open',
  acknowledged: 'acknowledged',
  closed: 'closed',
  archived: 'closed',
};

export const parseSeeClickFixIssues = (data: z.infer<typeof seeClickFixIssuesSchema>): PublicReport[] =>
  data.issues.flatMap((i) => {
    if (!isValidCoordinate(i.lat, i.lng)) return [];
    const title = (i.summary ?? i.request_type?.title ?? 'Reported issue').trim().slice(0, 140);
    const status = STATUS[(i.status ?? '').toLowerCase()] ?? 'unknown';
    const report: PublicReport = {
      id: `seeclickfix:${i.id}`,
      provider: 'seeclickfix',
      providerName: i.request_type?.organization ? `SeeClickFix · ${i.request_type.organization}` : 'SeeClickFix',
      title,
      description: i.description?.slice(0, 600) ?? undefined,
      rawCategory: i.request_type?.title ?? undefined,
      mappedCategory: mapRawCategory(i.request_type?.title ?? undefined, i.summary ?? undefined),
      status,
      rawStatus: i.status,
      latitude: i.lat as number,
      longitude: i.lng as number,
      address: i.address ?? undefined,
      createdAt: i.created_at ?? undefined,
      updatedAt: i.updated_at ?? undefined,
      url: safeHttpUrl(i.html_url) ?? `https://seeclickfix.com/issues/${i.id}`,
      imageUrl: safeHttpUrl(i.media?.image_square_100x100 ?? i.media?.representative_image_url),
    };
    return [report];
  });

export const seeClickFixProvider: CivicDataProvider = {
  id: 'seeclickfix',
  name: 'SeeClickFix',
  coverage: 'Cities and counties across the US that use SeeClickFix',
  url: 'https://seeclickfix.com',
  appliesTo: () => true,
  async fetchNearby(point: LatLng, radiusMeters: number, signal?: AbortSignal): Promise<PublicReport[]> {
    const b = boundsAround(point, radiusMeters);
    const url =
      `${BASE}/issues?min_lat=${b.minLat.toFixed(6)}&max_lat=${b.maxLat.toFixed(6)}` +
      `&min_lng=${b.minLng.toFixed(6)}&max_lng=${b.maxLng.toFixed(6)}` +
      '&status=open,acknowledged,closed&per_page=100&page=1';
    const data = await requestJson(url, {
      schema: seeClickFixIssuesSchema,
      label: 'SeeClickFix',
      timeoutMs: 12_000,
      retries: 1,
      minIntervalMs: 500,
      headers: { 'User-Agent': appConfig.userAgent },
      signal,
    });
    return parseSeeClickFixIssues(data);
  },
};

/** Request types the local SeeClickFix organisation accepts at this point (if covered). */
export const fetchSeeClickFixRequestTypes = async (point: LatLng, signal?: AbortSignal): Promise<RequestTypeHint[]> => {
  const url = `${BASE}/issues/new?lat=${point.latitude.toFixed(6)}&lng=${point.longitude.toFixed(6)}`;
  const data = await requestJson(url, {
    schema: seeClickFixRequestTypesSchema,
    label: 'SeeClickFix request types',
    timeoutMs: 10_000,
    retries: 0,
    headers: { 'User-Agent': appConfig.userAgent },
    signal,
  });
  // Reports are filed through SeeClickFix's own app/site; the API's
  // request-type URLs are API endpoints, not pages a person can open.
  return data.request_types.map((t) => ({
    title: t.title,
    organization: t.organization ?? undefined,
    url: 'https://seeclickfix.com',
  }));
};
