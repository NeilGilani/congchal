import { CATEGORY_INFO } from '@/constants/categories';
import type { DepartmentMatch } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import type { Jurisdiction, RoadContext } from '@/models/location';

import { CITY_DIRECTORY } from './cityDirectory';

/** Generic responsibility by category, used when no city-specific entry exists. */
export const GENERIC_DEPARTMENT: Record<IssueCategory, string> = {
  pothole: 'Public Works / Streets',
  pavement_crack: 'Public Works / Streets',
  sidewalk_damage: 'Public Works',
  graffiti: 'Public Works or Code Enforcement',
  overflowing_trash: 'Sanitation / Public Works',
  illegal_dumping: 'Sanitation or Code Enforcement',
  damaged_sign: 'Transportation / Traffic Engineering',
  fallen_tree: 'Public Works / Urban Forestry',
  flooding: 'Public Works / Stormwater',
  pedestrian_obstruction: 'Public Works or Code Enforcement',
  other: 'Public Works',
};

/** Categories that, on a numbered state/US route, usually go to the state DOT. */
const STATE_ROUTE_CATEGORIES: ReadonlySet<IssueCategory> = new Set([
  'pothole',
  'pavement_crack',
  'damaged_sign',
  'flooding',
  'fallen_tree',
]);

export interface RequestTypeHint {
  title: string;
  organization?: string;
  url?: string;
}

const KEYWORDS: Record<IssueCategory, RegExp> = {
  pothole: /pot\s?hole|pavement|street (repair|defect)/i,
  pavement_crack: /pavement|street (repair|defect)|road (damage|repair)|crack/i,
  sidewalk_damage: /sidewalk|curb|trip/i,
  graffiti: /graffiti|vandal/i,
  overflowing_trash: /trash|litter|garbage|refuse|can|bin/i,
  illegal_dumping: /dump|bulky|abandoned (item|furniture)/i,
  damaged_sign: /sign/i,
  fallen_tree: /tree|branch|limb/i,
  flooding: /flood|drain|storm|ponding|water/i,
  pedestrian_obstruction: /obstruct|block|sidewalk|encroach/i,
  other: /other|general/i,
};

/** Picks the jurisdiction's own request type that best matches a category, if any. */
export const matchRequestType = (category: IssueCategory, types: readonly RequestTypeHint[]): RequestTypeHint | undefined =>
  types.find((t) => KEYWORDS[category].test(t.title));

const searchUrl = (category: IssueCategory, j: Jurisdiction | undefined): string => {
  const where = j?.place?.name ?? j?.county?.name ?? j?.state?.name ?? '';
  const q = `${where} ${j?.state?.code ?? ''} report ${CATEGORY_INFO[category].noun} 311`.replace(/\s+/g, ' ').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
};

/**
 * Determines who most likely handles an issue. Never claims certainty it
 * doesn't have: "confirmed" only when the jurisdiction's own reporting system
 * lists a matching request type.
 */
export const matchDepartment = (
  category: IssueCategory,
  jurisdiction: Jurisdiction | undefined,
  roadContext?: RoadContext,
  requestTypes: readonly RequestTypeHint[] = [],
): DepartmentMatch => {
  const requestType = matchRequestType(category, requestTypes);
  if (requestType) {
    return {
      name: requestType.organization ?? GENERIC_DEPARTMENT[category],
      organization: requestType.organization,
      certainty: 'confirmed',
      basis: `This area's public reporting system lists a "${requestType.title}" request type.`,
      requestType: requestType.title,
      reportingUrl: requestType.url,
      reportingLabel: 'Report in the official system',
    };
  }

  if (roadContext?.isStateRoute && STATE_ROUTE_CATEGORIES.has(category) && jurisdiction?.state) {
    const stateName = jurisdiction.state.name;
    return {
      name: `${stateName} Department of Transportation`,
      organization: `State of ${stateName}`,
      certainty: 'likely',
      basis: `OpenStreetMap shows this spot on ${roadContext.routeRef ?? 'a numbered state route'}. State routes are usually maintained by the state DOT, even inside cities.`,
      reportingUrl: searchUrl(category, jurisdiction),
      reportingLabel: `Find ${stateName} DOT's reporting page`,
    };
  }

  const placeId = jurisdiction?.place?.incorporated ? jurisdiction.place.geoid : undefined;
  const city = placeId ? CITY_DIRECTORY[placeId] : undefined;
  if (city) {
    const name = city.departments[category];
    return {
      name: name ?? GENERIC_DEPARTMENT[category],
      organization: `City of ${city.name}`,
      certainty: name ? 'likely' : 'general',
      basis: name
        ? `${city.name} routes this kind of request to ${name} (CivicLens city directory, reviewed Oct 2026). Confirm on ${city.reportingLabel}.`
        : `${city.name} accepts reports through ${city.reportingLabel}; the handling department wasn't in CivicLens's directory.`,
      reportingUrl: city.reportingUrl,
      reportingLabel: `Open ${city.reportingLabel}`,
      phone: city.phone,
    };
  }

  if (jurisdiction?.responsibleLevel === 'county' && jurisdiction.county) {
    return {
      name: `${jurisdiction.county.name} ${category === 'graffiti' || category === 'illegal_dumping' ? 'Code Enforcement / Public Works' : 'Public Works / Roads'}`,
      organization: jurisdiction.county.name,
      certainty: 'general',
      basis: 'This point is outside any incorporated city, so the county usually maintains local roads and public spaces.',
      reportingUrl: searchUrl(category, jurisdiction),
      reportingLabel: `Find ${jurisdiction.county.name}'s reporting page`,
    };
  }

  const org = jurisdiction?.place?.name ? `City of ${jurisdiction.place.name}` : undefined;
  return {
    name: GENERIC_DEPARTMENT[category],
    organization: org,
    certainty: 'general',
    basis: jurisdiction
      ? 'Typical department for this kind of issue. Departments vary by city, so check the local reporting page.'
      : 'Location unknown. This is the typical department for this kind of issue.',
    reportingUrl: jurisdiction ? searchUrl(category, jurisdiction) : undefined,
    reportingLabel: jurisdiction ? 'Search for the official reporting page' : undefined,
  };
};
