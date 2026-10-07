import {
  approximateJurisdictionFromAddress,
  nominatimSchema,
  parseNominatimAddress,
} from '@/services/jurisdiction/nominatim';

/** Nominatim `/reverse?format=jsonv2&addressdetails=1&zoom=18` for San José City Hall. */
const sanJoseCityHall = {
  place_id: 297431455,
  licence: 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright',
  osm_type: 'way',
  osm_id: 43301290,
  lat: '37.3378501',
  lon: '-121.8862048',
  category: 'amenity',
  type: 'townhall',
  place_rank: 30,
  importance: 0.30001,
  addresstype: 'amenity',
  name: 'San José City Hall',
  display_name:
    'San José City Hall, 200, East Santa Clara Street, Downtown, San Jose, Santa Clara County, California, 95113, United States',
  address: {
    amenity: 'San José City Hall',
    house_number: '200',
    road: 'East Santa Clara Street',
    neighbourhood: 'Downtown',
    city: 'San Jose',
    county: 'Santa Clara County',
    state: 'California',
    'ISO3166-2-lvl4': 'US-CA',
    postcode: '95113',
    country: 'United States',
    country_code: 'us',
  },
  boundingbox: ['37.3373187', '37.3384052', '-121.8868412', '-121.8855321'],
};

/** A rural point: no house number, a hamlet instead of a city. */
const mountHamilton = {
  display_name: 'Mount Hamilton Road, Mount Hamilton, Santa Clara County, California, United States',
  address: {
    road: 'Mount Hamilton Road',
    hamlet: 'Mount Hamilton',
    county: 'Santa Clara County',
    state: 'California',
    'ISO3166-2-lvl4': 'US-CA',
    country: 'United States',
    country_code: 'us',
  },
};

/** Outside the US the ISO code is not a US state code, so the full state name is kept. */
const toronto = {
  display_name: '100, Queen Street West, Financial District, Toronto, Ontario, M5H 2N2, Canada',
  address: {
    house_number: '100',
    road: 'Queen Street West',
    suburb: 'Financial District',
    city: 'Toronto',
    state: 'Ontario',
    'ISO3166-2-lvl4': 'CA-ON',
    postcode: 'M5H 2N2',
    country: 'Canada',
    country_code: 'ca',
  },
};

const parse = (raw: unknown) => parseNominatimAddress(nominatimSchema.parse(raw));

describe('parseNominatimAddress', () => {
  it('builds a postal-style address from a reverse-geocoding result', () => {
    expect(parse(sanJoseCityHall)).toEqual({
      line1: '200 East Santa Clara Street',
      street: 'East Santa Clara Street',
      city: 'San Jose',
      county: 'Santa Clara County',
      state: 'CA',
      postalCode: '95113',
      country: 'US',
      formatted: '200 East Santa Clara Street, San Jose, CA 95113',
      source: 'nominatim',
    });
  });

  it('uses the hamlet as the city and the road as the first line in rural areas', () => {
    const a = parse(mountHamilton);
    expect(a?.city).toBe('Mount Hamilton');
    expect(a?.line1).toBe('Mount Hamilton Road');
    expect(a?.formatted).toBe('Mount Hamilton Road, Mount Hamilton, CA');
  });

  it('keeps the state name when the ISO code is not a US state', () => {
    const a = parse(toronto);
    expect(a?.state).toBe('Ontario');
    expect(a?.country).toBe('CA');
    expect(a?.formatted).toBe('100 Queen Street West, Toronto, Ontario M5H 2N2');
  });

  it('falls back to the neighbourhood when there is no road', () => {
    const a = parse({ address: { neighbourhood: 'Downtown', city: 'San Jose', 'ISO3166-2-lvl4': 'US-CA' } });
    expect(a?.line1).toBeUndefined();
    expect(a?.formatted).toBe('Downtown, San Jose, CA');
  });

  it('returns undefined for the "Unable to geocode" error and for empty answers', () => {
    expect(parse({ error: 'Unable to geocode' })).toBeUndefined();
    expect(parse({ display_name: 'Somewhere' })).toBeUndefined();
    expect(parse({ address: {} })).toBeUndefined();
  });

  it('uses display_name when the address has no usable parts', () => {
    expect(parse({ display_name: 'Pacific Ocean', address: { country_code: 'us' } })?.formatted).toBe('Pacific Ocean');
  });

  it('rejects a body whose address fields have the wrong types', () => {
    expect(nominatimSchema.safeParse({ address: { house_number: 200 } }).success).toBe(false);
  });
});

describe('approximateJurisdictionFromAddress', () => {
  it('is explicitly approximate and never claims who is responsible', () => {
    const addr = parse(sanJoseCityHall);
    if (!addr) throw new Error('fixture did not parse');
    const j = approximateJurisdictionFromAddress(addr, 'nominatim', new Date('2026-10-06T17:00:00Z'));
    expect(j).toEqual({
      country: 'US',
      state: { name: 'CA', code: 'CA' },
      county: { name: 'Santa Clara County' },
      place: { name: 'San Jose', incorporated: true },
      responsibleLevel: 'unknown',
      displayName: 'San Jose, CA',
      source: 'nominatim',
      confidence: 'approximate',
      resolvedAt: '2026-10-06T17:00:00.000Z',
    });
    // No GEOID: a postal city name must not be matched against official boundaries.
    expect(j?.place?.geoid).toBeUndefined();
  });

  it('does not give a 2-letter code to a full state name, and needs a city or state', () => {
    const toronto2 = parse(toronto);
    if (!toronto2) throw new Error('fixture did not parse');
    expect(approximateJurisdictionFromAddress(toronto2, 'nominatim')?.state).toEqual({ name: 'Ontario', code: undefined });
    expect(approximateJurisdictionFromAddress({ formatted: 'Somewhere', source: 'nominatim' }, 'nominatim')).toBeUndefined();
  });
});
