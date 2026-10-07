/**
 * Trimmed US Census Geocoder responses for
 * `geocoder/geographies/coordinates?...&layers=all&format=json`. Field names
 * and layer keys follow the live API (TIGERweb attributes); the parser only
 * reads States, Counties, Incorporated Places and Census Designated Places, so
 * the other layers are kept to check they are ignored. Fixtures are raw JSON
 * values: tests run them through the real zod schema first.
 */
const input = (x: number, y: number) => ({
  benchmark: {
    isDefault: true,
    benchmarkDescription: 'Public Address Ranges - Current Benchmark',
    id: '4',
    benchmarkName: 'Public_AR_Current',
  },
  vintage: {
    isDefault: true,
    id: '4',
    vintageName: 'Current_Current',
    vintageDescription: 'Current Vintage - Current Benchmark',
  },
  location: { x, y },
});

const california = {
  STATENS: '01779778',
  GEOID: '06',
  CENTLAT: '+37.1551773',
  AREAWATER: 20291712025,
  STATE: '06',
  BASENAME: 'California',
  STUSAB: 'CA',
  OID: 27490331115355,
  LSADC: '00',
  FUNCSTAT: 'A',
  INTPTLAT: '+37.1551773',
  DIVISION: '9',
  NAME: 'California',
  REGION: '4',
  OBJECTID: 34,
  CENTLON: '-119.5434183',
  AREALAND: 403673617332,
  INTPTLON: '-119.5434183',
  MTFCC: 'G4000',
};

const santaClaraCounty = {
  GEOID: '06085',
  CENTLAT: '+37.2207965',
  AREAWATER: 54487183,
  BASENAME: 'Santa Clara',
  STATE: '06',
  OID: 27590325007236,
  LSADC: '06',
  FUNCSTAT: 'A',
  INTPTLAT: '+37.2318813',
  NAME: 'Santa Clara County',
  OBJECTID: 1092,
  CENTLON: '-121.6951162',
  COUNTYCC: 'H1',
  COUNTYNS: '00277307',
  AREALAND: 3343889387,
  INTPTLON: '-121.6909190',
  MTFCC: 'G4020',
  COUNTY: '085',
};

/** San José City Hall, 200 E Santa Clara St (inside the incorporated City of San José). */
export const SAN_JOSE_POINT = { latitude: 37.3382, longitude: -121.8863 };

export const censusSanJose = {
  result: {
    input: input(-121.8863, 37.3382),
    geographies: {
      '2020 Census Blocks': [{ GEOID: '060855001011007', BLOCK: '1007', NAME: 'Block 1007', STATE: '06', MTFCC: 'G5040' }],
      States: [california],
      'Census Tracts': [{ GEOID: '06085500100', TRACT: '500100', NAME: 'Census Tract 5001', BASENAME: '5001', STATE: '06' }],
      'County Subdivisions': [{ GEOID: '0608592830', NAME: 'San Jose CCD', BASENAME: 'San Jose', LSADC: '22', STATE: '06' }],
      Counties: [santaClaraCounty],
      'Incorporated Places': [
        {
          GEOID: '0668000',
          CENTLAT: '+37.2966853',
          AREAWATER: 9330148,
          STATE: '06',
          BASENAME: 'San Jose',
          OID: 280403852037627,
          LSADC: '25',
          FUNCSTAT: 'A',
          INTPTLAT: '+37.2967193',
          NAME: 'San Jose city',
          OBJECTID: 11034,
          CENTLON: '-121.8189659',
          PLACE: '68000',
          PLACENS: '02411790',
          PLACECC: 'C1',
          AREALAND: 460337424,
          INTPTLON: '-121.8185924',
          MTFCC: 'G4110',
        },
      ],
      '119th Congressional Districts': [{ GEOID: '0616', NAME: 'Congressional District 16', BASENAME: '16', STATE: '06' }],
      'Unified School Districts': [{ GEOID: '0634590', NAME: 'San José Unified School District', STATE: '06' }],
    },
  },
};

/** East Los Angeles: an unincorporated census-designated place in Los Angeles County. */
export const censusEastLosAngeles = {
  result: {
    geographies: {
      States: [california],
      Counties: [
        { GEOID: '06037', BASENAME: 'Los Angeles', NAME: 'Los Angeles County', STATE: '06', COUNTY: '037', LSADC: '06', FUNCSTAT: 'A' },
      ],
      'Incorporated Places': [],
      'Census Designated Places': [
        { GEOID: '0620802', BASENAME: 'East Los Angeles', NAME: 'East Los Angeles CDP', STATE: '06', LSADC: '57', FUNCSTAT: 'S' },
      ],
      'Census Tracts': [{ GEOID: '06037531101', NAME: 'Census Tract 5311.01', STATE: '06' }],
    },
  },
};

/** Rural Santa Clara County east of San José (Mount Hamilton Road): no incorporated place and no CDP. */
export const censusRuralSantaClara = {
  result: {
    geographies: {
      States: [california],
      Counties: [santaClaraCounty],
      'Incorporated Places': [],
      'Census Designated Places': [],
      'County Subdivisions': [{ GEOID: '0608592830', NAME: 'San Jose CCD', STATE: '06' }],
    },
  },
};

/** Point in the Pacific Ocean: the geocoder answers with empty layers. */
export const censusOutsideUs = {
  result: {
    geographies: {
      States: [],
      Counties: [],
      'Incorporated Places': [],
      'Census Designated Places': [],
    },
  },
};
