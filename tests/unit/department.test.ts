import { ISSUE_CATEGORIES } from '@/models/issue';
import type { RoadContext } from '@/models/location';
import { CITY_DIRECTORY } from '@/services/civic/cityDirectory';
import { GENERIC_DEPARTMENT, matchDepartment, matchRequestType } from '@/services/civic/departmentService';
import { censusResponseSchema, parseCensusJurisdiction } from '@/services/jurisdiction/census';
import { approximateJurisdictionFromAddress } from '@/services/jurisdiction/nominatim';

import { censusEastLosAngeles, censusSanJose } from '../fixtures/census';

const jurisdictionOf = (raw: unknown) => {
  const j = parseCensusJurisdiction(censusResponseSchema.parse(raw));
  if (!j) throw new Error('fixture did not resolve');
  return j;
};

const sanJose = jurisdictionOf(censusSanJose);
const eastLA = jurisdictionOf(censusEastLosAngeles);
/** Santa Clara (city), GEOID 0669084: incorporated, but not in the built-in directory. */
const santaClaraCity = jurisdictionOf({
  result: {
    geographies: {
      ...censusSanJose.result.geographies,
      'Incorporated Places': [{ GEOID: '0669084', BASENAME: 'Santa Clara', NAME: 'Santa Clara city' }],
    },
  },
});

const stateRoute: RoadContext = {
  nearestRoadName: 'Guadalupe Parkway',
  roadClass: 'motorway',
  routeRef: 'CA 87',
  isStateRoute: true,
  source: 'openstreetmap',
  fetchedAt: '2026-10-06T17:00:00Z',
};
const cityStreet: RoadContext = { ...stateRoute, nearestRoadName: 'West Julian Street', roadClass: 'secondary', routeRef: undefined, isStateRoute: false };

describe('matchDepartment', () => {
  it('names the directory department for a city in the directory, as "likely", with the official channel', () => {
    const d = matchDepartment('pothole', sanJose, cityStreet);
    expect(d.name).toBe('Department of Transportation');
    expect(d.organization).toBe('City of San José');
    expect(d.certainty).toBe('likely');
    expect(d.reportingUrl).toBe(CITY_DIRECTORY['0668000']?.reportingUrl);
    expect(d.reportingLabel).toBe('Open San José 311');
    expect(d.phone).toBe('408-794-1900');
    expect(d.basis).toContain('Confirm on San José 311');
  });

  it('falls back to general guidance but keeps the official channel when the directory lacks the category', () => {
    const d = matchDepartment('flooding', sanJose);
    expect(d.certainty).toBe('general');
    expect(d.name).toBe(GENERIC_DEPARTMENT.flooding);
    expect(d.reportingUrl).toBe(CITY_DIRECTORY['0668000']?.reportingUrl);
  });

  it('sends roadway issues on a numbered state route to the state DOT, even inside a city', () => {
    const d = matchDepartment('pothole', sanJose, stateRoute);
    expect(d.name).toBe('California Department of Transportation');
    expect(d.organization).toBe('State of California');
    expect(d.certainty).toBe('likely');
    expect(d.basis).toContain('CA 87');
    const q = new URL(d.reportingUrl ?? '').searchParams.get('q');
    expect(q).toBe('San Jose CA report pothole 311');
  });

  it('keeps graffiti on a state route with the city', () => {
    const d = matchDepartment('graffiti', sanJose, stateRoute);
    expect(d.organization).toBe('City of San José');
    expect(d.name).toContain('Anti-Graffiti');
  });

  it('is confirmed only when the area\'s own system lists a matching request type', () => {
    const types = [
      { title: 'Abandoned Vehicle', organization: 'City of San José' },
      { title: 'Pothole Repair', organization: 'City of San José', url: 'https://seeclickfix.com' },
    ];
    const d = matchDepartment('pothole', sanJose, stateRoute, types);
    expect(d.certainty).toBe('confirmed');
    expect(d.requestType).toBe('Pothole Repair');
    expect(d.reportingUrl).toBe('https://seeclickfix.com');
  });

  it('gives general guidance for an incorporated city that is not in the directory', () => {
    const d = matchDepartment('pothole', santaClaraCity);
    expect(d.certainty).toBe('general');
    expect(d.name).toBe('Public Works / Streets');
    expect(d.organization).toBe('City of Santa Clara');
    expect(d.reportingUrl).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
  });

  it('points unincorporated areas at the county', () => {
    const d = matchDepartment('illegal_dumping', eastLA);
    expect(d.certainty).toBe('general');
    expect(d.organization).toBe('Los Angeles County');
    expect(d.name).toBe('Los Angeles County Code Enforcement / Public Works');
    expect(matchDepartment('pothole', eastLA).name).toBe('Los Angeles County Public Works / Roads');
  });

  it('does not use the directory for an address-based (approximate) city name', () => {
    const approx = approximateJurisdictionFromAddress(
      { city: 'San Jose', state: 'CA', formatted: 'San Jose, CA', source: 'device-geocoder' },
      'device-geocoder',
    );
    const d = matchDepartment('pothole', approx);
    expect(d.certainty).toBe('general');
    expect(d.organization).toBe('City of San Jose');
  });

  it('is honest when the location is unknown', () => {
    const d = matchDepartment('graffiti', undefined);
    expect(d).toEqual({
      name: 'Public Works or Code Enforcement',
      organization: undefined,
      certainty: 'general',
      basis: 'Location unknown. This is the typical department for this kind of issue.',
      reportingUrl: undefined,
      reportingLabel: undefined,
    });
  });
});

describe('matchRequestType', () => {
  it('matches common 311 request type titles to categories', () => {
    const types = [{ title: 'Graffiti Removal' }, { title: 'Pothole' }, { title: 'Illegal Dumping / Bulky Items' }];
    expect(matchRequestType('pothole', types)?.title).toBe('Pothole');
    expect(matchRequestType('graffiti', types)?.title).toBe('Graffiti Removal');
    expect(matchRequestType('illegal_dumping', types)?.title).toBe('Illegal Dumping / Bulky Items');
    expect(matchRequestType('fallen_tree', types)).toBeUndefined();
  });
});

describe('CITY_DIRECTORY', () => {
  const entries = Object.entries(CITY_DIRECTORY);

  it('is keyed by 7-digit Census place GEOIDs that match each entry', () => {
    expect(entries.length).toBeGreaterThan(10);
    for (const [key, city] of entries) {
      expect(key).toMatch(/^\d{7}$/);
      expect(city.geoid).toBe(key);
    }
  });

  it('only links to https reporting pages and only uses known categories', () => {
    for (const [, city] of entries) {
      expect(city.reportingUrl).toMatch(/^https:\/\//);
      for (const category of Object.keys(city.departments)) {
        expect(ISSUE_CATEGORIES).toContain(category);
      }
    }
  });
});
