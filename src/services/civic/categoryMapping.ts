import type { IssueCategory } from '@/models/issue';

/**
 * Maps free-text 311 request types / titles from public systems onto
 * CivicLens categories. Order matters: more specific patterns first.
 */
const RULES: readonly [RegExp, IssueCategory][] = [
  [/pot\s?hole/i, 'pothole'],
  [/graffiti|tagging/i, 'graffiti'],
  [/(illegal|fly)[\s-]?dump|bulky (item|waste)|abandoned (furniture|items?|mattress)|dumping/i, 'illegal_dumping'],
  [/(overflow|full).*(basket|can|bin|trash|garbage|litter)|litter|dirty (condition|street|sidewalk)|street (and|&) sidewalk cleaning|trash|garbage/i, 'overflowing_trash'],
  [/sign\b|signs\b|signage|street sign/i, 'damaged_sign'],
  [/tree|branch|limb/i, 'fallen_tree'],
  [/flood|ponding|catch basin|storm ?drain|water on street|sewer backup/i, 'flooding'],
  [/sidewalk (condition|repair|damage|defect|inspection)|curb (damage|repair)|trip hazard|sidewalk or curb/i, 'sidewalk_damage'],
  [/block(ed)? (sidewalk|street|path)|obstruct|encroach/i, 'pedestrian_obstruction'],
  [/street (condition|defect|repair)|pavement|road (damage|repair|surface)|crack/i, 'pavement_crack'],
];

export const mapRawCategory = (...texts: (string | undefined)[]): IssueCategory | undefined => {
  const text = texts.filter(Boolean).join(' | ');
  if (!text) return undefined;
  for (const [re, cat] of RULES) if (re.test(text)) return cat;
  return undefined;
};

/** How similar two categories are for duplicate detection (1 = same). */
export const categorySimilarity = (a: IssueCategory, b: IssueCategory | undefined): number => {
  if (!b) return 0.3;
  if (a === b) return 1;
  const related: readonly (readonly IssueCategory[])[] = [
    ['pothole', 'pavement_crack'],
    ['overflowing_trash', 'illegal_dumping'],
    ['sidewalk_damage', 'pedestrian_obstruction'],
    ['sidewalk_damage', 'pavement_crack'],
    ['fallen_tree', 'pedestrian_obstruction'],
  ];
  return related.some((pair) => pair.includes(a) && pair.includes(b)) ? 0.6 : 0;
};
