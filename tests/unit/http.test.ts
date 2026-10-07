import { z } from 'zod';

import { describeNetworkError, getLatencySamples, NetworkError, requestJson, type NetworkErrorKind } from '@/api/http';
import { buildSocrataUrl, SOCRATA_DATASETS, socrataProviders } from '@/services/civic/providers/socrata';
import { parseSeeClickFixIssues, seeClickFixIssuesSchema } from '@/services/civic/providers/seeClickFix';

import { calledUrl, hangingFetch, jsonResponse, scriptFetch } from '../support/fetch';

const pointSchema = z.object({ lat: z.number(), lon: z.number() });
const URL_A = 'https://api.example.org/point';

const failure = async (p: Promise<unknown>): Promise<NetworkError> => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof NetworkError)) throw new Error(`expected a NetworkError, got ${String(e)}`);
  return e;
};

const realFetch = global.fetch;
let warn: jest.SpyInstance;
beforeEach(() => {
  // Schema mismatches are logged in development builds; keep test output clean.
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = realFetch;
  warn.mockRestore();
});

describe('requestJson', () => {
  it('returns schema-validated data and sends JSON headers', async () => {
    const fetchMock = scriptFetch(jsonResponse({ lat: 37.3382, lon: -121.8863, extra: 'stripped' }));
    const data = await requestJson(URL_A, { schema: pointSchema, label: 'Example', headers: { 'User-Agent': 'CivicLens/test' } });
    expect(data).toEqual({ lat: 37.3382, lon: -121.8863 });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({ Accept: 'application/json', 'User-Agent': 'CivicLens/test' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an already-aborted signal without calling fetch', async () => {
    const fetchMock = scriptFetch(jsonResponse({ lat: 1, lon: 2 }));
    const controller = new AbortController();
    controller.abort();
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', signal: controller.signal }));
    expect(e.kind).toBe('aborted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels an in-flight request as soon as the caller aborts', async () => {
    hangingFetch();
    const controller = new AbortController();
    const started = Date.now();
    const pending = failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', signal: controller.signal, timeoutMs: 30_000 }));
    setTimeout(() => controller.abort(), 20);
    const e = await pending;
    expect(e.kind).toBe('aborted');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('rejects data that fails the schema as invalid_response, without retrying', async () => {
    const fetchMock = scriptFetch(jsonResponse({ lat: '37.3382' }), jsonResponse({ lat: 1, lon: 2 }));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 2 }));
    expect(e.kind).toBe('invalid_response');
    expect(e.message).toBe('Example returned data in an unexpected format.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a body that is not JSON as invalid_response', async () => {
    scriptFetch(new Response('<html>Service Unavailable</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }));
    expect(e.kind).toBe('invalid_response');
    expect(e.message).toMatch(/isn't valid JSON/);
  });

  it('reports a fetch that throws (network down) as offline and names the host', async () => {
    const fetchMock = scriptFetch(new TypeError('Network request failed'));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }));
    expect(e.kind).toBe('offline');
    expect(e.message).toBe("Couldn't reach api.example.org.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports HTTP 429 as rate_limited with the Retry-After delay', async () => {
    scriptFetch(jsonResponse({ error: 'slow down' }, 429, { 'Retry-After': '30' }));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }));
    expect(e.kind).toBe('rate_limited');
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(30_000);
  });

  it('caps Retry-After at a minute and understands HTTP dates', async () => {
    scriptFetch(jsonResponse({}, 429, { 'Retry-After': '3600' }));
    expect((await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }))).retryAfterMs).toBe(60_000);
    scriptFetch(jsonResponse({}, 429, { 'Retry-After': new Date(Date.now() + 5_000).toUTCString() }));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }));
    expect(e.retryAfterMs).toBeGreaterThan(3_000);
    expect(e.retryAfterMs).toBeLessThanOrEqual(5_000);
  });

  it('retries a rate-limited request after the advertised delay', async () => {
    const fetchMock = scriptFetch(jsonResponse({}, 429, { 'Retry-After': '0' }), jsonResponse({ lat: 1, lon: 2 }));
    await expect(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 1 })).resolves.toEqual({ lat: 1, lon: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP 500 as an http error with the status', async () => {
    scriptFetch(jsonResponse({ message: 'Internal Server Error' }, 500));
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 0 }));
    expect(e.kind).toBe('http');
    expect(e.status).toBe(500);
    expect(e.message).toBe('Example responded with 500.');
  });

  it('retries server errors with backoff but not client errors', async () => {
    const retried = scriptFetch(jsonResponse({}, 503), jsonResponse({ lat: 1, lon: 2 }));
    await expect(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 1 })).resolves.toEqual({ lat: 1, lon: 2 });
    expect(retried).toHaveBeenCalledTimes(2);

    const notRetried = scriptFetch(jsonResponse({}, 404), jsonResponse({ lat: 1, lon: 2 }));
    expect((await failure(requestJson(URL_A, { schema: pointSchema, label: 'Example', retries: 2 }))).status).toBe(404);
    expect(notRetried).toHaveBeenCalledTimes(1);
  });

  it('times out a request that never answers', async () => {
    const fetchMock = hangingFetch();
    const e = await failure(requestJson(URL_A, { schema: pointSchema, label: 'Census geocoder', timeoutMs: 30, retries: 0 }));
    expect(e.kind).toBe('timeout');
    expect(e.message).toBe('Census geocoder timed out.');
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('reports a caller cancellation during the request as aborted, promptly and without retrying', async () => {
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    const pending = requestJson(URL_A, { schema: pointSchema, label: 'Example', timeoutMs: 10_000, retries: 3, signal: controller.signal });
    while (fetchMock.mock.calls.length === 0) await new Promise((r) => setTimeout(r, 1));
    const abortedAt = Date.now();
    controller.abort();
    expect((await failure(pending)).kind).toBe('aborted');
    expect(Date.now() - abortedAt).toBeLessThan(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('spaces out requests to the same host when asked to', async () => {
    const times: number[] = [];
    const ok = () => {
      times.push(Date.now());
      return Promise.resolve(jsonResponse({ lat: 1, lon: 2 }));
    };
    scriptFetch(ok, ok);
    const opts = { schema: pointSchema, label: 'Throttled', minIntervalMs: 120 };
    await requestJson('https://throttle.example.org/a', opts);
    await requestJson('https://throttle.example.org/b', opts);
    expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(100);
  });

  it('records latency samples by label', async () => {
    scriptFetch(jsonResponse({ lat: 1, lon: 2 }));
    await requestJson(URL_A, { schema: pointSchema, label: 'Latency probe' });
    const sample = [...getLatencySamples()].reverse().find((s) => s.label === 'Latency probe');
    expect(sample?.status).toBe(200);
    expect(sample?.ms).toBeGreaterThanOrEqual(0);
  });
});

describe('describeNetworkError', () => {
  it.each<[NetworkErrorKind, number | undefined, RegExp]>([
    ['offline', undefined, /offline/],
    ['timeout', undefined, /too long/],
    ['rate_limited', 429, /busy/],
    ['invalid_response', undefined, /could not read/],
    ['aborted', undefined, /Cancelled/],
    ['http', 503, /having problems/],
    ['http', 403, /rejected/],
  ])('explains %s (%p) to a person', (kind, status, message) => {
    expect(describeNetworkError(new NetworkError(kind, 'internal detail', status))).toMatch(message);
  });

  it('has a generic message for anything else', () => {
    expect(describeNetworkError(new Error('boom'))).toBe('Something went wrong while contacting the service.');
    expect(describeNetworkError(undefined)).toBe('Something went wrong while contacting the service.');
  });
});

describe('Socrata provider (NYC 311)', () => {
  const nyc = socrataProviders.find((p) => p.id === 'nyc311');
  const nycDataset = SOCRATA_DATASETS.find((d) => d.id === 'nyc311');
  const empireState = { latitude: 40.748441, longitude: -73.985664 };

  /** Rows as returned by the SODA API: every value is a string, coordinates can be missing. */
  const rows = [
    {
      unique_key: '62911234',
      created_date: '2026-09-28T14:03:12.000',
      complaint_type: 'Street Condition',
      descriptor: 'Pothole',
      incident_address: '350 5 AVENUE',
      status: 'Open',
      latitude: '40.748441',
      longitude: '-73.985664',
    },
    {
      unique_key: '62905511',
      created_date: '2026-09-27T09:41:55.000',
      closed_date: '2026-09-30T11:00:00.000',
      complaint_type: 'Graffiti',
      descriptor: 'Graffiti',
      incident_address: '20 WEST 34 STREET',
      status: 'Closed',
      latitude: '40.748910',
      longitude: '-73.985220',
    },
    {
      unique_key: '62899870',
      created_date: '2026-09-26T18:20:01.000',
      complaint_type: 'Dirty Condition',
      descriptor: 'Trash',
      status: 'In Progress',
      latitude: '40.747980',
      longitude: '-73.986100',
    },
    { unique_key: '62899871', created_date: '2026-09-26T18:22:00.000', complaint_type: 'Noise - Street/Sidewalk', descriptor: 'Loud Talking', status: 'Open' },
    {
      unique_key: '62899872',
      created_date: '2026-09-26T19:00:00.000',
      complaint_type: 'Noise - Residential',
      descriptor: 'Loud Music/Party',
      status: 'Assigned',
      latitude: '40.748001',
      longitude: '-73.984990',
    },
  ];

  it('applies only to New York City', () => {
    expect(nyc?.appliesTo({ country: 'US', place: { name: 'New York', geoid: '3651000', incorporated: true }, responsibleLevel: 'city', displayName: 'New York, NY', source: 'census', confidence: 'authoritative', resolvedAt: '' }, empireState)).toBe(true);
    expect(nyc?.appliesTo(undefined, empireState)).toBe(false);
  });

  it('builds a within_circle SoQL query for recent requests', () => {
    if (!nycDataset) throw new Error('dataset missing');
    const url = new URL(buildSocrataUrl(nycDataset, empireState, 149.6, '2026-04-09T17:00:00.000Z'));
    expect(url.origin + url.pathname).toBe('https://data.cityofnewyork.us/resource/erm2-nwe9.json');
    expect(url.searchParams.get('$where')).toBe(
      "within_circle(location, 40.748441, -73.985664, 150) AND created_date > '2026-04-09T17:00:00'",
    );
    expect(url.searchParams.get('$order')).toBe('created_date DESC');
    expect(url.searchParams.get('$limit')).toBe('200');
  });

  it('parses rows into public reports, skipping rows without coordinates', async () => {
    const fetchMock = scriptFetch(jsonResponse(rows));
    const reports = (await nyc?.fetchNearby(empireState, 150)) ?? [];
    expect(calledUrl(fetchMock)).toMatch(/^https:\/\/data\.cityofnewyork\.us\/resource\/erm2-nwe9\.json\?/);
    expect(reports.map((r) => r.id)).toEqual(['nyc311:62911234', 'nyc311:62905511', 'nyc311:62899870', 'nyc311:62899872']);
    expect(reports[0]).toEqual({
      id: 'nyc311:62911234',
      provider: 'nyc311',
      providerName: 'NYC 311',
      title: 'Street Condition – Pothole',
      rawCategory: 'Street Condition',
      mappedCategory: 'pothole',
      status: 'open',
      rawStatus: 'Open',
      latitude: 40.748441,
      longitude: -73.985664,
      address: '350 5 AVENUE',
      createdAt: '2026-09-28T14:03:12.000',
    });
    expect(reports.map((r) => [r.mappedCategory, r.status])).toEqual([
      ['pothole', 'open'],
      ['graffiti', 'closed'],
      ['overflowing_trash', 'acknowledged'],
      [undefined, 'acknowledged'],
    ]);
  });

  it('rejects a Socrata error object as invalid_response', async () => {
    scriptFetch(jsonResponse({ code: 'query.compiler.malformed', error: true, message: 'Could not parse SoQL query' }));
    const e = await failure(nyc?.fetchNearby(empireState, 150) ?? Promise.resolve());
    expect(e.kind).toBe('invalid_response');
  });
});

describe('SeeClickFix parsing', () => {
  const body = {
    issues: [
      {
        id: 16032211,
        status: 'Acknowledged',
        summary: 'Pothole',
        description: 'Large pothole in the right lane, cars are swerving.',
        rating: 2,
        lat: 37.33876,
        lng: -121.88512,
        address: '250 E Santa Clara St, San Jose, CA 95113, USA',
        created_at: '2026-10-01T15:32:00-07:00',
        acknowledged_at: '2026-10-02T08:00:00-07:00',
        closed_at: null,
        updated_at: '2026-10-02T09:10:00-07:00',
        url: 'https://seeclickfix.com/api/v2/issues/16032211',
        html_url: 'https://seeclickfix.com/issues/16032211-pothole',
        request_type: { id: 12345, title: 'Pothole', organization: 'City of San José', url: 'https://seeclickfix.com/api/v2/request_types/12345' },
        media: { video_url: null, image_full: null, image_square_100x100: 'https://seeclickfix.com/files/issue_images/0016/square.jpg', representative_image_url: null },
      },
      {
        id: 16032212,
        status: 'Archived',
        summary: null,
        description: null,
        lat: 37.3391,
        lng: -121.8849,
        html_url: 'javascript:alert(1)',
        request_type: { title: 'Graffiti Removal', organization: null },
        media: null,
      },
      { id: 16032213, status: 'Open', summary: 'No location', lat: null, lng: null },
    ],
    metadata: { pagination: { entries: 3, page: 1, per_page: 100, pages: 1 } },
  };

  it('maps issues to public reports and never trusts unsafe links', () => {
    const reports = parseSeeClickFixIssues(seeClickFixIssuesSchema.parse(body));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      id: 'seeclickfix:16032211',
      providerName: 'SeeClickFix · City of San José',
      title: 'Pothole',
      mappedCategory: 'pothole',
      status: 'acknowledged',
      url: 'https://seeclickfix.com/issues/16032211-pothole',
      imageUrl: 'https://seeclickfix.com/files/issue_images/0016/square.jpg',
    });
    expect(reports[1]).toMatchObject({
      title: 'Graffiti Removal',
      providerName: 'SeeClickFix',
      mappedCategory: 'graffiti',
      status: 'closed',
      url: 'https://seeclickfix.com/issues/16032212',
      imageUrl: undefined,
    });
  });

  it('rejects a body without an issues array', () => {
    expect(seeClickFixIssuesSchema.safeParse({ errors: { base: ['Not found'] } }).success).toBe(false);
    expect(seeClickFixIssuesSchema.safeParse({ issues: [{ id: '16032211' }] }).success).toBe(false);
  });
});
