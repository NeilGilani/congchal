import type { CategoryGroup, IssueCategory } from '@/models/issue';

export type IconName =
  | 'pothole'
  | 'crack'
  | 'sidewalk'
  | 'graffiti'
  | 'trash'
  | 'dumping'
  | 'sign'
  | 'tree'
  | 'water'
  | 'obstruction'
  | 'other';

export interface CategoryInfo {
  id: IssueCategory;
  label: string;
  /** Used in "Possible <noun> detected." */
  noun: string;
  group: CategoryGroup;
  icon: IconName;
  /** What CivicLens visually looks for (shown in About / Issue Detail). */
  looksFor: string;
  /** Where this kind of issue usually is: drives the "location" severity factor. */
  typicalSurface: 'roadway' | 'sidewalk' | 'either' | 'structure';
  /** Baseline hazard (0..1) of the category before visual evidence. */
  baseHazard: number;
  /** Whether it can affect pedestrian accessibility. */
  accessibilityRelevant: boolean;
}

export const CATEGORY_INFO: Record<IssueCategory, CategoryInfo> = {
  pothole: {
    id: 'pothole',
    label: 'Pothole',
    noun: 'pothole',
    group: 'roads',
    icon: 'pothole',
    looksFor: 'A bowl-shaped hole or depression in a paved surface.',
    typicalSurface: 'roadway',
    baseHazard: 0.65,
    accessibilityRelevant: false,
  },
  pavement_crack: {
    id: 'pavement_crack',
    label: 'Pavement cracking',
    noun: 'pavement damage',
    group: 'roads',
    icon: 'crack',
    looksFor: 'Linear or web-like cracks and crumbling in road pavement.',
    typicalSurface: 'roadway',
    baseHazard: 0.35,
    accessibilityRelevant: false,
  },
  sidewalk_damage: {
    id: 'sidewalk_damage',
    label: 'Sidewalk damage',
    noun: 'sidewalk damage',
    group: 'sidewalks',
    icon: 'sidewalk',
    looksFor: 'Broken, lifted, or uneven sidewalk slabs.',
    typicalSurface: 'sidewalk',
    baseHazard: 0.5,
    accessibilityRelevant: true,
  },
  graffiti: {
    id: 'graffiti',
    label: 'Graffiti',
    noun: 'graffiti',
    group: 'other',
    icon: 'graffiti',
    looksFor: 'Spray-painted tags or writing on walls, signs, or public property.',
    typicalSurface: 'structure',
    baseHazard: 0.1,
    accessibilityRelevant: false,
  },
  overflowing_trash: {
    id: 'overflowing_trash',
    label: 'Overflowing trash / litter',
    noun: 'overflowing trash or litter',
    group: 'waste',
    icon: 'trash',
    looksFor: 'Garbage overflowing from bins or litter spread on the ground.',
    typicalSurface: 'either',
    baseHazard: 0.2,
    accessibilityRelevant: false,
  },
  illegal_dumping: {
    id: 'illegal_dumping',
    label: 'Illegal dumping',
    noun: 'dumped items',
    group: 'waste',
    icon: 'dumping',
    looksFor: 'Discarded furniture, mattresses, tires, or piles of junk outdoors.',
    typicalSurface: 'either',
    baseHazard: 0.3,
    accessibilityRelevant: true,
  },
  damaged_sign: {
    id: 'damaged_sign',
    label: 'Damaged sign',
    noun: 'damaged sign',
    group: 'signs',
    icon: 'sign',
    looksFor: 'Bent, knocked-down, faded, or vandalized traffic and street signs.',
    typicalSurface: 'structure',
    baseHazard: 0.45,
    accessibilityRelevant: false,
  },
  fallen_tree: {
    id: 'fallen_tree',
    label: 'Fallen tree / branches',
    noun: 'fallen tree or branches',
    group: 'other',
    icon: 'tree',
    looksFor: 'A downed tree or large branches lying on a road or path.',
    typicalSurface: 'either',
    baseHazard: 0.6,
    accessibilityRelevant: true,
  },
  flooding: {
    id: 'flooding',
    label: 'Flooding / standing water',
    noun: 'standing water',
    group: 'roads',
    icon: 'water',
    looksFor: 'Water covering a street, sidewalk, or pooling at a storm drain.',
    typicalSurface: 'either',
    baseHazard: 0.5,
    accessibilityRelevant: true,
  },
  pedestrian_obstruction: {
    id: 'pedestrian_obstruction',
    label: 'Blocked pedestrian path',
    noun: 'pedestrian path obstruction',
    group: 'accessibility',
    icon: 'obstruction',
    looksFor: 'Objects, vehicles, or materials blocking a sidewalk or curb ramp.',
    typicalSurface: 'sidewalk',
    baseHazard: 0.45,
    accessibilityRelevant: true,
  },
  other: {
    id: 'other',
    label: 'Other issue',
    noun: 'issue',
    group: 'other',
    icon: 'other',
    looksFor: 'Anything else you want to report. Chosen by you, not detected.',
    typicalSurface: 'either',
    baseHazard: 0.3,
    accessibilityRelevant: false,
  },
};

export const GROUP_LABELS: Record<CategoryGroup | 'all', string> = {
  all: 'All',
  roads: 'Roads',
  sidewalks: 'Sidewalks',
  accessibility: 'Accessibility',
  waste: 'Waste',
  signs: 'Signs',
  other: 'Other',
};

export const categoryLabel = (c: IssueCategory | 'none'): string =>
  c === 'none' ? 'No issue' : CATEGORY_INFO[c].label;
