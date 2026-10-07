import type { IssueCategory } from '@/models/issue';

/**
 * Built-in directory of official reporting channels for large US cities,
 * keyed by Census place GEOID (state FIPS + place FIPS). Department names are
 * what each city's own 311 materials use for that kind of request. They change
 * over time, so the app always labels them "likely" and links to the official
 * channel for confirmation.
 *
 * Last reviewed: October 2026.
 */
export interface CityEntry {
  geoid: string;
  name: string;
  reportingUrl: string;
  reportingLabel: string;
  phone?: string;
  departments: Partial<Record<IssueCategory, string>>;
}

export const CITY_DIRECTORY: Record<string, CityEntry> = {
  '3651000': {
    geoid: '3651000',
    name: 'New York City',
    reportingUrl: 'https://portal.311.nyc.gov/',
    reportingLabel: 'NYC311',
    phone: '311',
    departments: {
      pothole: 'Department of Transportation (DOT)',
      pavement_crack: 'Department of Transportation (DOT)',
      sidewalk_damage: 'Department of Transportation (DOT)',
      damaged_sign: 'Department of Transportation (DOT)',
      graffiti: 'Department of Sanitation (DSNY)',
      overflowing_trash: 'Department of Sanitation (DSNY)',
      illegal_dumping: 'Department of Sanitation (DSNY)',
      fallen_tree: 'Department of Parks and Recreation',
      flooding: 'Department of Environmental Protection (DEP)',
    },
  },
  '0644000': {
    geoid: '0644000',
    name: 'Los Angeles',
    reportingUrl: 'https://myla311.lacity.gov/',
    reportingLabel: 'MyLA311',
    phone: '311',
    departments: {
      pothole: 'StreetsLA (Bureau of Street Services)',
      pavement_crack: 'StreetsLA (Bureau of Street Services)',
      sidewalk_damage: 'StreetsLA (Bureau of Street Services)',
      fallen_tree: 'StreetsLA Urban Forestry Division',
      damaged_sign: 'Department of Transportation (LADOT)',
      graffiti: 'Office of Community Beautification',
      overflowing_trash: 'LA Sanitation & Environment (LASAN)',
      illegal_dumping: 'LA Sanitation & Environment (LASAN)',
    },
  },
  '1714000': {
    geoid: '1714000',
    name: 'Chicago',
    reportingUrl: 'https://311.chicago.gov/',
    reportingLabel: 'CHI311',
    phone: '311',
    departments: {
      pothole: 'Department of Transportation (CDOT)',
      pavement_crack: 'Department of Transportation (CDOT)',
      sidewalk_damage: 'Department of Transportation (CDOT)',
      damaged_sign: 'Department of Transportation (CDOT)',
      graffiti: 'Department of Streets and Sanitation',
      overflowing_trash: 'Department of Streets and Sanitation',
      illegal_dumping: 'Department of Streets and Sanitation',
      fallen_tree: 'Department of Streets and Sanitation (Bureau of Forestry)',
      flooding: 'Department of Water Management',
    },
  },
  '4835000': {
    geoid: '4835000',
    name: 'Houston',
    reportingUrl: 'https://www.houstontx.gov/311/',
    reportingLabel: 'Houston 311',
    phone: '311',
    departments: {
      pothole: 'Houston Public Works',
      pavement_crack: 'Houston Public Works',
      sidewalk_damage: 'Houston Public Works',
      damaged_sign: 'Houston Public Works',
      flooding: 'Houston Public Works',
      overflowing_trash: 'Solid Waste Management Department',
      illegal_dumping: 'Solid Waste Management Department',
    },
  },
  '0455000': {
    geoid: '0455000',
    name: 'Phoenix',
    reportingUrl: 'https://www.phoenix.gov/myphx311',
    reportingLabel: 'myPHX311',
    phone: '602-262-6441',
    departments: {
      pothole: 'Street Transportation Department',
      pavement_crack: 'Street Transportation Department',
      sidewalk_damage: 'Street Transportation Department',
      damaged_sign: 'Street Transportation Department',
    },
  },
  '4260000': {
    geoid: '4260000',
    name: 'Philadelphia',
    reportingUrl: 'https://www.phila.gov/departments/philly311/',
    reportingLabel: 'Philly311',
    phone: '311',
    departments: {
      pothole: 'Streets Department',
      pavement_crack: 'Streets Department',
      damaged_sign: 'Streets Department',
      overflowing_trash: 'Streets Department (Sanitation)',
      illegal_dumping: 'Streets Department (Sanitation)',
      graffiti: 'Community Life Improvement Program (CLIP)',
      fallen_tree: 'Parks & Recreation',
    },
  },
  '0666000': {
    geoid: '0666000',
    name: 'San Diego',
    reportingUrl: 'https://www.sandiego.gov/get-it-done',
    reportingLabel: 'Get It Done',
    departments: {
      pothole: 'Transportation Department',
      pavement_crack: 'Transportation Department',
      sidewalk_damage: 'Transportation Department',
      damaged_sign: 'Transportation Department',
      illegal_dumping: 'Environmental Services Department',
      overflowing_trash: 'Environmental Services Department',
      flooding: 'Stormwater Department',
    },
  },
  '0668000': {
    geoid: '0668000',
    name: 'San José',
    reportingUrl: 'https://www.sanjoseca.gov/your-government/departments-offices/information-technology/san-jos-311-8839',
    reportingLabel: 'San José 311',
    phone: '408-794-1900',
    departments: {
      pothole: 'Department of Transportation',
      pavement_crack: 'Department of Transportation',
      sidewalk_damage: 'Department of Transportation',
      damaged_sign: 'Department of Transportation',
      fallen_tree: 'Department of Transportation',
      graffiti: 'Parks, Recreation & Neighborhood Services (Anti-Graffiti Program)',
      illegal_dumping: 'Environmental Services Department',
      overflowing_trash: 'Environmental Services Department',
    },
  },
  '0667000': {
    geoid: '0667000',
    name: 'San Francisco',
    reportingUrl: 'https://www.sf.gov/topics/311-online-services',
    reportingLabel: 'SF311',
    phone: '311',
    departments: {
      pothole: 'San Francisco Public Works',
      pavement_crack: 'San Francisco Public Works',
      sidewalk_damage: 'San Francisco Public Works',
      graffiti: 'San Francisco Public Works',
      overflowing_trash: 'San Francisco Public Works',
      illegal_dumping: 'San Francisco Public Works',
      fallen_tree: 'San Francisco Public Works (Bureau of Urban Forestry)',
      damaged_sign: 'SF Municipal Transportation Agency (SFMTA)',
      flooding: 'SF Public Utilities Commission (SFPUC)',
    },
  },
  '2507000': {
    geoid: '2507000',
    name: 'Boston',
    reportingUrl: 'https://www.boston.gov/departments/boston-311',
    reportingLabel: 'BOS:311',
    phone: '311',
    departments: {
      pothole: 'Public Works Department',
      pavement_crack: 'Public Works Department',
      sidewalk_damage: 'Public Works Department',
      overflowing_trash: 'Public Works Department',
      damaged_sign: 'Transportation Department',
    },
  },
  '1150000': {
    geoid: '1150000',
    name: 'Washington, DC',
    reportingUrl: 'https://311.dc.gov/',
    reportingLabel: 'DC 311',
    phone: '311',
    departments: {
      pothole: 'District Department of Transportation (DDOT)',
      pavement_crack: 'District Department of Transportation (DDOT)',
      sidewalk_damage: 'District Department of Transportation (DDOT)',
      damaged_sign: 'District Department of Transportation (DDOT)',
      fallen_tree: 'DDOT Urban Forestry Division',
      graffiti: 'Department of Public Works (DPW)',
      overflowing_trash: 'Department of Public Works (DPW)',
      illegal_dumping: 'Department of Public Works (DPW)',
    },
  },
  '5363000': {
    geoid: '5363000',
    name: 'Seattle',
    reportingUrl: 'https://www.seattle.gov/customer-service-bureau/find-it-fix-it-mobile-app',
    reportingLabel: 'Find It, Fix It',
    departments: {
      pothole: 'Seattle Department of Transportation (SDOT)',
      pavement_crack: 'Seattle Department of Transportation (SDOT)',
      sidewalk_damage: 'Seattle Department of Transportation (SDOT)',
      damaged_sign: 'Seattle Department of Transportation (SDOT)',
      graffiti: 'Seattle Public Utilities (SPU)',
      illegal_dumping: 'Seattle Public Utilities (SPU)',
      overflowing_trash: 'Seattle Public Utilities (SPU)',
      flooding: 'Seattle Public Utilities (SPU)',
    },
  },
  '4159000': {
    geoid: '4159000',
    name: 'Portland',
    reportingUrl: 'https://www.portland.gov/311',
    reportingLabel: 'PDX 311',
    phone: '311',
    departments: {
      pothole: 'Portland Bureau of Transportation (PBOT)',
      pavement_crack: 'Portland Bureau of Transportation (PBOT)',
      sidewalk_damage: 'Portland Bureau of Transportation (PBOT)',
      damaged_sign: 'Portland Bureau of Transportation (PBOT)',
    },
  },
  '2404000': {
    geoid: '2404000',
    name: 'Baltimore',
    reportingUrl: 'https://balt311.baltimorecity.gov/',
    reportingLabel: 'Baltimore 311',
    phone: '311',
    departments: {
      pothole: 'Department of Transportation',
      pavement_crack: 'Department of Transportation',
      damaged_sign: 'Department of Transportation',
      overflowing_trash: 'Department of Public Works',
      illegal_dumping: 'Department of Public Works',
    },
  },
  '4805000': {
    geoid: '4805000',
    name: 'Austin',
    reportingUrl: 'https://www.austintexas.gov/department/311',
    reportingLabel: 'Austin 3-1-1',
    phone: '311',
    departments: {
      pothole: 'Transportation and Public Works Department',
      pavement_crack: 'Transportation and Public Works Department',
      sidewalk_damage: 'Transportation and Public Works Department',
      damaged_sign: 'Transportation and Public Works Department',
      overflowing_trash: 'Austin Resource Recovery',
    },
  },
};
