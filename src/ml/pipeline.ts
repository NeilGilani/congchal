import type { CategoryScore, Detection, Evidence, ModelInfo } from '@/models/detection';
import type { ConfidenceLevel, DetectableCategory, ModelClass } from '@/models/issue';
import type { AnalysisOutcome } from '@/models/scan';
import { newId } from '@/utils/ids';

import { buildEvidence, buildExplanation } from './explain';
import type { CivicHead, ClassProbabilities, ConceptScore } from './head';
import { cropToSquare } from './image/resize';
import { packNchw } from './image/tensor';
import type { NormalizedRect, RgbImage } from './image/types';
import { checkImageQuality, type ImageQualityReport } from './quality';
import { REGION_SETS, rectArea, rectUnion, type RegionSetName } from './regions';
import { EMBEDDING_DIM, MODEL_INPUT_SIZE } from './runtime/ortBackend';
import type { EmbeddingBackend } from './runtime/types';
import { estimateSeverity } from './severity';

export interface RegionResult {
  id: string;
  rect: NormalizedRect;
  probabilities: ClassProbabilities;
}

export interface TopCandidate {
  category: DetectableCategory;
  probability: number;
  level: ConfidenceLevel;
  region?: NormalizedRect;
  /** True when the candidate came only from a sub-region (small object rescue). */
  viaRegion: boolean;
}

export interface ImageAnalysis {
  outcome: AnalysisOutcome;
  quality: ImageQualityReport;
  probabilities?: ClassProbabilities;
  top?: TopCandidate;
  concepts?: ConceptScore[];
  regions?: RegionResult[];
  regionsAnalyzed: number;
  timings: { qualityMs: number; preprocessMs: number; inferenceMs: number; postMs: number; totalMs: number };
}

const issueEntries = (p: ClassProbabilities): [DetectableCategory, number][] =>
  (Object.entries(p) as [ModelClass, number][]).filter((e): e is [DetectableCategory, number] => e[0] !== 'none');

const argmaxIssue = (p: ClassProbabilities): [DetectableCategory, number] | undefined =>
  issueEntries(p).reduce<[DetectableCategory, number] | undefined>((best, e) => (!best || e[1] > best[1] ? e : best), undefined);

/**
 * Region of strongest evidence for `category`: the union of grid windows whose
 * probability is within `boxRelative` of the peak. Returns undefined when the
 * evidence is spread over (almost) the whole frame or too weak to localise.
 */
export const evidenceRegion = (
  regions: readonly RegionResult[],
  category: DetectableCategory,
  boxRelative: number,
  minPeak: number,
): NormalizedRect | undefined => {
  const grid = regions.filter((r) => r.id.startsWith('g'));
  if (grid.length === 0) return undefined;
  const peak = Math.max(...grid.map((r) => r.probabilities[category] ?? 0));
  if (peak < minPeak) return undefined;
  const chosen = grid.filter((r) => (r.probabilities[category] ?? 0) >= peak * boxRelative).map((r) => r.rect);
  const box = rectUnion(chosen);
  if (!box || rectArea(box) > 0.8) return undefined;
  return box;
};

export interface AnalyzeOptions {
  backend: EmbeddingBackend;
  head: CivicHead;
  mode: RegionSetName;
  /** Skip the quality gate (evaluation of the classifier alone). */
  skipQualityGate?: boolean;
}

export const analyzeImage = async (image: RgbImage, opts: AnalyzeOptions): Promise<ImageAnalysis> => {
  const t0 = Date.now();
  const quality = checkImageQuality(image);
  const t1 = Date.now();
  if (!quality.ok && !opts.skipQualityGate) {
    return {
      outcome: 'rejected_quality',
      quality,
      regionsAnalyzed: 0,
      timings: { qualityMs: t1 - t0, preprocessMs: 0, inferenceMs: 0, postMs: 0, totalMs: t1 - t0 },
    };
  }

  const regions = REGION_SETS[opts.mode];
  const crops = regions.map((r) => cropToSquare(image, r.rect, MODEL_INPUT_SIZE));
  const pixels = packNchw(crops, MODEL_INPUT_SIZE);
  const t2 = Date.now();
  const emb = await opts.backend.embed(pixels, crops.length);
  const t3 = Date.now();

  const { head } = opts;
  const logits = regions.map((_, i) => head.logits(emb, i * EMBEDDING_DIM));
  const fullIdx = regions.findIndex((r) => r.id === 'full');
  const centerIdx = regions.findIndex((r) => r.id === 'center');
  const imageProbs = head.probabilities(logits[fullIdx] as Float32Array, logits[centerIdx] as Float32Array);
  const regionResults: RegionResult[] = regions.map((r, i) => ({
    id: r.id,
    rect: r.rect,
    probabilities: head.probabilities(logits[i] as Float32Array),
  }));

  const { detect, high, uncertain } = head.def.thresholds;
  const { rescueThreshold, boxRelative, boxMinPeak } = head.def.region;
  const warningsCap = quality.issues.some((i) => i.level === 'warning');

  let top: TopCandidate | undefined;
  let outcome: AnalysisOutcome = 'none';
  const best = argmaxIssue(imageProbs);
  if (best && best[1] >= uncertain) {
    const [category, p] = best;
    const level: ConfidenceLevel = p >= detect ? (p >= high && !warningsCap ? 'high' : 'moderate') : 'low';
    top = {
      category,
      probability: p,
      level,
      region: evidenceRegion(regionResults, category, boxRelative, boxMinPeak),
      viaRegion: false,
    };
    outcome = p >= detect ? 'detected' : 'uncertain';
  } else {
    // Small-object rescue: a single window may see what the full frame misses.
    // Held to the stricter high-confidence bar and only ever reported as "possible".
    let rescue: [DetectableCategory, number, NormalizedRect] | undefined;
    for (const r of regionResults) {
      if (!r.id.startsWith('g')) continue;
      const m = argmaxIssue(r.probabilities);
      if (m && m[1] >= rescueThreshold && (!rescue || m[1] > rescue[1])) rescue = [m[0], m[1], r.rect];
    }
    if (rescue) {
      top = { category: rescue[0], probability: rescue[1], level: 'low', region: rescue[2], viaRegion: true };
      outcome = 'uncertain';
    }
  }

  // Concept probes (explanations/severity) use the evidence region when there is one.
  let conceptSource = fullIdx;
  if (top?.region) {
    const g = regionResults
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.id.startsWith('g'))
      .sort((a, b) => (b.r.probabilities[top?.category ?? 'none'] ?? 0) - (a.r.probabilities[top?.category ?? 'none'] ?? 0))[0];
    if (g) conceptSource = g.i;
  }
  const concepts = head.concepts(emb, conceptSource * EMBEDDING_DIM);
  const t4 = Date.now();

  return {
    outcome,
    quality,
    probabilities: imageProbs,
    top,
    concepts,
    regions: regionResults,
    regionsAnalyzed: regions.length,
    timings: { qualityMs: t1 - t0, preprocessMs: t2 - t1, inferenceMs: t3 - t2, postMs: t4 - t3, totalMs: t4 - t0 },
  };
};

export const topScores = (p: ClassProbabilities | undefined, n = 4): CategoryScore[] =>
  p
    ? (Object.entries(p) as [ModelClass, number][])
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([category, probability]) => ({ category, probability }))
    : [];

/** Converts a pipeline result into the app's Detection records. */
export const toDetections = (analysis: ImageAnalysis, model: ModelInfo, extraEvidence: Evidence[] = [], now = new Date()): Detection[] => {
  const top = analysis.top;
  if (!top || !analysis.concepts) return [];
  const evidence = [...buildEvidence(top.category, analysis.concepts), ...extraEvidence];
  if (top.viaRegion) {
    evidence.push({
      id: 'region-only',
      kind: 'visual',
      label: 'Seen in one part of the frame only',
      supports: false,
    });
  }
  const severity = estimateSeverity({
    category: top.category,
    confidence: top.probability,
    concepts: analysis.concepts,
    regionArea: top.region ? rectArea(top.region) : undefined,
  });
  return [
    {
      id: newId('det'),
      category: top.category,
      confidence: top.probability,
      confidenceLevel: top.level,
      boundingBox: top.region,
      severity,
      evidence,
      explanation: buildExplanation(top.category, top.level, evidence),
      model,
      timestamp: now.toISOString(),
    },
  ];
};

export const sceneContext = (concepts: readonly ConceptScore[] | undefined): Evidence[] =>
  (concepts ?? [])
    .filter((c) => c.id.startsWith('ctx:') && c.z >= 1)
    .sort((a, b) => b.z - a.z)
    .slice(0, 3)
    .map((c) => ({ id: c.id, kind: 'context' as const, label: c.label, strength: c.z, supports: c.id !== 'ctx:indoors' }));
