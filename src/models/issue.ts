/** Every issue type the vision model can output, plus `other` for user-chosen reports. */
export const ISSUE_CATEGORIES = [
  'pothole',
  'pavement_crack',
  'sidewalk_damage',
  'graffiti',
  'overflowing_trash',
  'illegal_dumping',
  'damaged_sign',
  'fallen_tree',
  'flooding',
  'pedestrian_obstruction',
  'other',
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/** Categories the vision model could in principle output. */
export type DetectableCategory = Exclude<IssueCategory, 'other'>;

/** Model classes are the detectable categories plus `none`. */
export type ModelClass = DetectableCategory | 'none';

export type CategoryGroup = 'roads' | 'sidewalks' | 'accessibility' | 'waste' | 'signs' | 'other';

export const isIssueCategory = (value: unknown): value is IssueCategory =>
  typeof value === 'string' && (ISSUE_CATEGORIES as readonly string[]).includes(value);

export type SeverityLevel = 'low' | 'moderate' | 'high';

export type ConfidenceLevel = 'high' | 'moderate' | 'low';
