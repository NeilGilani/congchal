import { CATEGORY_INFO } from '@/constants/categories';
import type { SeverityEstimate, SeverityFactor } from '@/models/detection';
import type { IssueCategory, SeverityLevel } from '@/models/issue';

import type { ConceptScore } from './head';

/** Maps a z-score to 0..1 (z=0 → 0.5, z=±2 → ~0.12/0.88). */
const squash = (z: number | undefined): number => (z === undefined ? 0.5 : 1 / (1 + Math.exp(-z)));

const zOf = (concepts: readonly ConceptScore[], id: string): number | undefined => concepts.find((c) => c.id === id)?.z;

export interface SeverityInput {
  category: IssueCategory;
  confidence: number;
  concepts: readonly ConceptScore[];
  /** Fraction of the frame covered by the evidence region (0..1), if known. */
  regionArea?: number;
}

export const SEVERITY_WEIGHTS = {
  safety: 0.35,
  accessibility: 0.2,
  size: 0.15,
  location: 0.15,
  obstruction: 0.15,
} as const;

/**
 * Transparent, rule-based severity *estimate*. Inputs are the category's
 * baseline hazard plus zero-shot concept probes from the same image (e.g. "in
 * a traffic lane", "tripping hazard", "large defect"). It is not a
 * measurement; the UI always labels it "Estimated severity".
 */
export const estimateSeverity = ({ category, confidence, concepts, regionArea }: SeverityInput): SeverityEstimate => {
  const info = CATEGORY_INFO[category];
  const roadway = squash(zOf(concepts, 'ctx:roadway'));
  const sidewalk = squash(zOf(concepts, 'ctx:sidewalk'));
  const inTraffic = squash(zOf(concepts, 'hz:in_traffic'));
  const tripping = squash(zOf(concepts, 'hz:tripping'));
  const large = squash(zOf(concepts, 'hz:large'));
  const minor = squash(zOf(concepts, 'hz:minor'));
  const wheelchair = squash(zOf(concepts, 'hz:blocks_wheelchair'));

  const sizeSignal = Math.min(1, Math.max(0, 0.5 + (large - minor)));
  const factors: SeverityFactor[] = [
    {
      id: 'safety',
      label: 'Safety',
      value: Math.min(1, info.baseHazard * (0.7 + 0.6 * inTraffic)),
      note: inTraffic > 0.65 ? 'Appears to be within a vehicle travel path.' : 'Baseline risk for this kind of issue.',
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      value: info.accessibilityRelevant ? Math.max(tripping, wheelchair) : 0.2 * tripping,
      note: info.accessibilityRelevant
        ? 'Could affect people walking or using mobility devices.'
        : 'Unlikely to affect pedestrian access.',
    },
    {
      id: 'size',
      label: 'Size',
      value: regionArea !== undefined ? 0.5 * sizeSignal + 0.5 * Math.min(1, Math.sqrt(regionArea) * 1.2) : sizeSignal,
      note: sizeSignal > 0.6 ? 'The defect looks large in the photo.' : sizeSignal < 0.4 ? 'The defect looks small.' : 'Size is unclear from the photo.',
    },
    {
      id: 'location',
      label: 'Location',
      value:
        info.typicalSurface === 'roadway'
          ? roadway
          : info.typicalSurface === 'sidewalk'
            ? sidewalk
            : Math.max(roadway, sidewalk) * 0.8,
      note:
        roadway > 0.65
          ? 'Located on what appears to be a roadway.'
          : sidewalk > 0.65
            ? 'Located on what appears to be a sidewalk or path.'
            : 'Surface type is unclear.',
    },
    {
      id: 'obstruction',
      label: 'Obstruction',
      value: ['illegal_dumping', 'flooding', 'fallen_tree', 'pedestrian_obstruction'].includes(category)
        ? Math.max(wheelchair, 0.5)
        : 0.3 * wheelchair,
      note: wheelchair > 0.65 ? 'May block normal movement.' : 'Unlikely to block movement.',
    },
  ];
  const confidenceFactor: SeverityFactor = {
    id: 'confidence',
    label: 'Confidence',
    value: confidence,
    note: 'Lower model confidence pulls the estimate toward the middle.',
  };
  const raw =
    factors.reduce((s, f) => s + f.value * SEVERITY_WEIGHTS[f.id as keyof typeof SEVERITY_WEIGHTS], 0) /
    Object.values(SEVERITY_WEIGHTS).reduce((a, b) => a + b, 0);
  // Shrink toward the midpoint when the detection itself is uncertain.
  const score = Math.round(100 * (0.5 + (raw - 0.5) * Math.min(1, Math.max(0.3, confidence))));
  const level: SeverityLevel = score >= 62 ? 'high' : score >= 42 ? 'moderate' : 'low';
  const top = [...factors].sort((a, b) => b.value - a.value)[0];
  const rationale =
    level === 'high'
      ? `${info.label} with ${top?.label.toLowerCase() ?? 'safety'} concerns. ${top?.note ?? ''}`.trim()
      : level === 'moderate'
        ? `${info.label} that may need attention. ${top?.note ?? ''}`.trim()
        : `${info.label} with no strong signs of immediate risk.`;
  return { level, score, factors: [...factors, confidenceFactor], rationale };
};
