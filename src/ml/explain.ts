import { CATEGORY_INFO } from '@/constants/categories';
import type { Evidence } from '@/models/detection';
import type { ConfidenceLevel, IssueCategory } from '@/models/issue';

import type { ConceptScore } from './head';

/** Concept probe prefixes that count as visual evidence for each category. */
const EVIDENCE_PREFIX: Partial<Record<IssueCategory, string>> = {
  pothole: 'ev:pothole:',
  pavement_crack: 'ev:crack:',
  graffiti: 'ev:graffiti:',
  overflowing_trash: 'ev:trash:',
  illegal_dumping: 'ev:dumping:',
  flooding: 'ev:flood:',
};

const CONTEXT_IDS = ['ctx:roadway', 'ctx:sidewalk', 'ctx:bike_lane', 'ctx:curb_ramp', 'ctx:crosswalk', 'ctx:wall', 'ctx:alley', 'ctx:parking', 'ctx:park'];

export const strengthLabel = (z: number): Evidence['strengthLabel'] => (z >= 2 ? 'strong' : z >= 1.2 ? 'moderate' : 'weak');

/**
 * Turns concept-probe scores into human-readable evidence. Only probes that
 * are clearly above what ordinary street scenes score (z ≥ 0.8) are shown,
 * so evidence is never invented to fill space.
 */
export const buildEvidence = (category: IssueCategory, concepts: readonly ConceptScore[]): Evidence[] => {
  const prefix = EVIDENCE_PREFIX[category];
  const visual = prefix
    ? concepts
        .filter((c) => c.id.startsWith(prefix) && c.z >= 0.8)
        .sort((a, b) => b.z - a.z)
        .slice(0, 3)
        .map<Evidence>((c) => ({ id: c.id, kind: 'visual', label: c.label, strength: c.z, strengthLabel: strengthLabel(c.z), supports: true }))
    : [];
  const context = concepts
    .filter((c) => CONTEXT_IDS.includes(c.id) && c.z >= 1)
    .sort((a, b) => b.z - a.z)
    .slice(0, 2)
    .map<Evidence>((c) => ({ id: c.id, kind: 'context', label: c.label, strength: c.z, strengthLabel: strengthLabel(c.z), supports: true }));
  const indoor = concepts.find((c) => c.id === 'ctx:indoors');
  const against: Evidence[] =
    indoor && indoor.z >= 1.5
      ? [{ id: 'ctx:indoors', kind: 'context', label: 'Looks like an indoor scene', strength: indoor.z, strengthLabel: strengthLabel(indoor.z), supports: false }]
      : [];
  return [...visual, ...context, ...against];
};

const CONFIDENCE_PHRASE: Record<ConfidenceLevel, string> = {
  high: 'Strong visual evidence of',
  moderate: 'Visual evidence suggests',
  low: 'Weak evidence of',
};

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

export const buildExplanation = (category: IssueCategory, level: ConfidenceLevel, evidence: readonly Evidence[]): string => {
  const info = CATEGORY_INFO[category];
  const visual = evidence.filter((e) => e.kind === 'visual' && e.supports).map((e) => lower(e.label));
  const context = evidence.find((e) => e.kind === 'context' && e.supports);
  // Mass nouns ("graffiti", "standing water", "pavement damage") take no article.
  const countable = ['pothole', 'damaged sign'].includes(info.noun);
  const article = countable ? 'a ' : '';
  let text = `${CONFIDENCE_PHRASE[level]} ${article}${info.noun}`;
  if (visual.length > 0) text += `: ${visual.join(', ')}`;
  if (context) text += `${visual.length > 0 ? '; ' : '. '}${context.label.toLowerCase()}`;
  return `${text}.`;
};
