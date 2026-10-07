import type { ConceptScore } from '@/ml/head';
import { estimateSeverity, SEVERITY_WEIGHTS, type SeverityInput } from '@/ml/severity';
import type { IssueCategory } from '@/models/issue';

/** Concept probe z-scores; anything not listed is "unknown" (squashed to 0.5). */
const concepts = (z: Record<string, number>): ConceptScore[] => Object.entries(z).map(([id, value]) => ({ id, label: id, z: value }));

const score = (input: Partial<SeverityInput> & { category: IssueCategory }): number =>
  estimateSeverity({ confidence: 1, concepts: [], ...input }).score;

const Z_SWEEP = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 4];

describe('estimateSeverity', () => {
  it('matches a hand computation for a pothole with no concept evidence', () => {
    // safety 0.65*(0.7+0.6*0.5)=0.65, accessibility 0.2*0.5=0.1, size 0.5, location 0.5, obstruction 0.3*0.5=0.15
    // raw = 0.35*0.65 + 0.2*0.1 + 0.15*0.5 + 0.15*0.5 + 0.15*0.15 = 0.42 -> 42 at full confidence.
    const est = estimateSeverity({ category: 'pothole', confidence: 1, concepts: [] });
    expect(est.score).toBe(42);
    expect(est.level).toBe('moderate');
    expect(est.factors.find((f) => f.id === 'safety')?.value).toBeCloseTo(0.65, 10);
    expect(est.factors.find((f) => f.id === 'confidence')?.value).toBe(1);
  });

  it('uses weights that sum to 1', () => {
    expect(Object.values(SEVERITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it.each([
    ['pothole', 'hz:in_traffic'],
    ['pothole', 'ctx:roadway'],
    ['pothole', 'hz:large'],
    ['sidewalk_damage', 'hz:tripping'],
    ['sidewalk_damage', 'ctx:sidewalk'],
    ['pedestrian_obstruction', 'hz:blocks_wheelchair'],
    ['illegal_dumping', 'hz:blocks_wheelchair'],
  ] as const)('never lowers the score of a %s as %s evidence grows', (category, probe) => {
    const scores = Z_SWEEP.map((z) => score({ category, concepts: concepts({ [probe]: z }) }));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] as number);
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0] as number);
  });

  it('never raises the score as the "small defect" probe grows', () => {
    const scores = Z_SWEEP.map((z) => score({ category: 'pothole', concepts: concepts({ 'hz:minor': z }) }));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] as number);
  });

  it('grows with the size of the evidence region', () => {
    const areas = [0.01, 0.05, 0.1, 0.25, 0.5];
    const scores = areas.map((regionArea) => score({ category: 'pothole', regionArea }));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] as number);
  });

  it('rates a large, hazardous pothole in a traffic lane as high and explains why', () => {
    // safety 0.826, accessibility 0.19, size 0.924, location 0.953, obstruction 0.286 -> raw 0.652 -> 65 at p=0.97.
    const est = estimateSeverity({
      category: 'pothole',
      confidence: 0.97,
      concepts: concepts({ 'hz:in_traffic': 3, 'ctx:roadway': 3, 'hz:large': 3, 'hz:minor': -2, 'hz:tripping': 3, 'hz:blocks_wheelchair': 3 }),
      regionArea: 0.5,
    });
    expect(est.score).toBe(65);
    expect(est.level).toBe('high');
    expect(est.score).toBeGreaterThanOrEqual(62);
    expect(est.factors.find((f) => f.id === 'safety')?.note).toBe('Appears to be within a vehicle travel path.');
    expect(est.rationale.startsWith('Pothole with')).toBe(true);
  });

  it('rates small graffiti off the roadway as low', () => {
    const est = estimateSeverity({ category: 'graffiti', confidence: 0.95, concepts: concepts({ 'hz:minor': 2, 'hz:large': -2 }) });
    expect(est.level).toBe('low');
    expect(est.rationale).toBe('Graffiti with no strong signs of immediate risk.');
  });

  it('maps scores to levels at 42 and 62', () => {
    const categories: IssueCategory[] = ['pothole', 'graffiti', 'flooding', 'sidewalk_damage', 'fallen_tree'];
    const seen = new Set<string>();
    for (const category of categories) {
      for (const z of Z_SWEEP) {
        for (const confidence of [0.2, 0.5, 0.8, 1]) {
          const est = estimateSeverity({
            category,
            confidence,
            concepts: concepts({ 'hz:in_traffic': z, 'hz:large': z, 'hz:tripping': z, 'hz:blocks_wheelchair': z, 'ctx:roadway': z }),
          });
          const expected = est.score >= 62 ? 'high' : est.score >= 42 ? 'moderate' : 'low';
          expect(est.level).toBe(expected);
          expect(est.score).toBeGreaterThanOrEqual(0);
          expect(est.score).toBeLessThanOrEqual(100);
          seen.add(est.level);
        }
      }
    }
    expect([...seen].sort()).toEqual(['high', 'low', 'moderate']);
  });

  it('pulls the score toward the middle as confidence drops', () => {
    const strong = concepts({ 'hz:in_traffic': 3, 'ctx:roadway': 3, 'hz:large': 3 });
    const sure = score({ category: 'pothole', confidence: 1, concepts: strong });
    const unsure = score({ category: 'pothole', confidence: 0.4, concepts: strong });
    expect(sure).toBeGreaterThan(50);
    expect(unsure).toBeGreaterThan(50);
    expect(unsure - 50).toBeLessThan(sure - 50);
    // The same hold below the midpoint: an uncertain low-risk detection is less confidently "low".
    const weak = concepts({ 'hz:minor': 3, 'hz:large': -3 });
    const sureLow = score({ category: 'graffiti', confidence: 1, concepts: weak });
    const unsureLow = score({ category: 'graffiti', confidence: 0.4, concepts: weak });
    expect(sureLow).toBeLessThan(unsureLow);
    expect(unsureLow).toBeLessThan(50);
  });

  it('shrinks proportionally to confidence, but never by more than 70%', () => {
    const strong = concepts({ 'hz:in_traffic': 3, 'ctx:roadway': 3, 'hz:large': 3 });
    const full = score({ category: 'pothole', confidence: 1, concepts: strong }) - 50;
    const half = score({ category: 'pothole', confidence: 0.5, concepts: strong }) - 50;
    // Both scores are rounded to integers, so allow one point of slack.
    expect(Math.abs(half - full / 2)).toBeLessThanOrEqual(1);
    expect(score({ category: 'pothole', confidence: 0.05, concepts: strong })).toBe(score({ category: 'pothole', confidence: 0.3, concepts: strong }));
  });
});
