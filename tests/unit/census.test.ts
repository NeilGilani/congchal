import { NetworkError } from '@/api/http';
import {
  buildCensusUrl,
  CENSUS_ENDPOINT,
  censusResponseSchema,
  fetchCensusJurisdiction,
  parseCensusJurisdiction,
} from '@/services/jurisdiction/census';

import {
  censusEastLosAngeles,
  censusOutsideUs,
  censusRuralSantaClara,
  censusSanJose,
  SAN_JOSE_POINT,
} from '../fixtures/census';
import { calledUrl, jsonResponse, scriptFetch } from '../support/fetch';

const NOW = new Date('2026-10-06T17:00:00Z');
const parse = (raw: unknown) => parseCensusJurisdiction(censusResponseSchema.parse(raw), NOW);

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('buildCensusUrl', () => {
  it('puts longitude in x and latitude in y with 6 decimals and asks for every layer', () => {
    const url = new URL(buildCensusUrl({ latitude: 37.33820049, longitude: -121.8863 }));
    expect(`${url.origin}${url.pathname}`).toBe(CENSUS_ENDPOINT);
    expect(url.searchParams.get('x')).toBe('-121.886300');
    expect(url.searchParams.get('y')).toBe('37.338200');
    expect(url.searchParams.get('layers')).toBe('all');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
    expect(url.searchParams.get('vintage')).toBe('Current_Current');
    expect(url.searchParams.get('format')).toBe('json');
  });
});

describe('parseCensusJurisdiction', () => {
  it('assigns a point inside San José to the city, with official GEOIDs', () => {
    const j = parse(censusSanJose);
    expect(j).toEqual({
      country: 'US',
      state: { name: 'California', geoid: '06', code: 'CA' },
      county: { name: 'Santa Clara County', geoid: '06085' },
      place: { name: 'San Jose', geoid: '0668000', incorporated: true },
      responsibleLevel: 'city',
      displayName: 'San Jose, CA',
      source: 'census',
      confidence: 'authoritative',
      resolvedAt: '2026-10-06T17:00:00.000Z',
    });
  });

  it('assigns an unincorporated census-designated place to the county and says so', () => {
    const j = parse(censusEastLosAngeles);
    expect(j?.responsibleLevel).toBe('county');
    expect(j?.place).toEqual({ name: 'East Los Angeles', geoid: '0620802', incorporated: false });
    expect(j?.county).toEqual({ name: 'Los Angeles County', geoid: '06037' });
    expect(j?.displayName).toBe('East Los Angeles (unincorporated), Los Angeles County, CA');
  });

  it('assigns rural county land with no place at all to the county', () => {
    const j = parse(censusRuralSantaClara);
    expect(j?.responsibleLevel).toBe('county');
    expect(j?.place).toBeUndefined();
    expect(j?.displayName).toBe('Unincorporated Santa Clara County, CA');
    expect(j?.county?.geoid).toBe('06085');
  });

  it('prefers the incorporated place over an overlapping CDP record', () => {
    const raw = {
      result: {
        geographies: {
          ...censusSanJose.result.geographies,
          'Census Designated Places': [{ GEOID: '0699999', BASENAME: 'Some CDP', NAME: 'Some CDP' }],
        },
      },
    };
    const j = parse(raw);
    expect(j?.place?.geoid).toBe('0668000');
    expect(j?.responsibleLevel).toBe('city');
  });

  it('returns undefined outside Census coverage (no state)', () => {
    expect(parse(censusOutsideUs)).toBeUndefined();
    expect(parse({ result: { geographies: {} } })).toBeUndefined();
  });

  it('degrades gracefully when only the state is known', () => {
    const j = parse({ result: { geographies: { States: [{ NAME: 'Nevada', GEOID: '32', STUSAB: 'NV' }] } } });
    expect(j?.responsibleLevel).toBe('unknown');
    expect(j?.displayName).toBe('Nevada');
    expect(j?.county).toBeUndefined();
  });

  it('omits the state code from the display name when STUSAB is missing', () => {
    const geographies = censusSanJose.result.geographies;
    const raw = { result: { geographies: { ...geographies, States: [{ NAME: 'California', GEOID: '06' }] } } };
    expect(parse(raw)?.displayName).toBe('San Jose');
  });
});

describe('censusResponseSchema', () => {
  it('accepts a real-shaped response including layers the parser ignores', () => {
    expect(censusResponseSchema.safeParse(censusSanJose).success).toBe(true);
  });

  it.each([
    ['an error payload', { errors: ['Invalid coordinates'], status: '400' }],
    ['a result without geographies', { result: { input: {} } }],
    ['a layer that is not an array', { result: { geographies: { States: { NAME: 'California' } } } }],
    ['a geography with a numeric GEOID', { result: { geographies: { States: [{ GEOID: 6 }] } } }],
  ])('rejects %s', (_label, raw) => {
    expect(censusResponseSchema.safeParse(raw).success).toBe(false);
  });
});

describe('fetchCensusJurisdiction', () => {
  it('requests the coordinates and parses the answer', async () => {
    const fetchMock = scriptFetch(jsonResponse(censusSanJose));
    const j = await fetchCensusJurisdiction(SAN_JOSE_POINT);
    expect(j?.place?.geoid).toBe('0668000');
    expect(calledUrl(fetchMock)).toBe(buildCensusUrl(SAN_JOSE_POINT));
  });

  it('rejects a malformed body as invalid_response without retrying or logging the coordinates', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = scriptFetch(jsonResponse({ result: { geographies: { States: 'CA' } } }));
    const err = await fetchCensusJurisdiction(SAN_JOSE_POINT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).kind).toBe('invalid_response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('schema mismatch');
    expect(logged).not.toContain('37.3382');
    warn.mockRestore();
  });
});
