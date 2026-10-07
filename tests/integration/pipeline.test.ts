// Must be first: makes onnxruntime-node's tensors pass instanceof checks inside Jest.
import '../support/mainRealmTypedArrays';

import { analyzeImage, toDetections, topScores, type ImageAnalysis } from '@/ml/pipeline';
import type { RegionSetName } from '@/ml/regions';
import type { RgbImage } from '@/ml/image/types';
import type { EmbeddingBackend } from '@/ml/runtime/types';

import {
  boxBlur,
  createBackend,
  loadDemoImage,
  loadHead,
  MODEL_AVAILABLE,
  MODEL_MISSING_MESSAGE,
  modelInfoFor,
  nearlyBlackFrame,
} from '../support/model';

const MODEL_TIMEOUT_MS = 120_000;

if (!MODEL_AVAILABLE) console.warn(MODEL_MISSING_MESSAGE);
const describeWithModel = MODEL_AVAILABLE ? describe : describe.skip;

describeWithModel('vision pipeline end to end (real ONNX model, bundled demo photos)', () => {
  const head = loadHead();
  let backend: EmbeddingBackend | undefined;

  beforeAll(async () => {
    backend = await createBackend();
  }, MODEL_TIMEOUT_MS);

  afterAll(async () => {
    await backend?.dispose();
  });

  const analyze = (image: RgbImage, mode: RegionSetName = 'scan'): Promise<ImageAnalysis> => {
    if (!backend) throw new Error('model backend failed to load');
    return analyzeImage(image, { backend, head, mode });
  };

  const totalProbability = (a: ImageAnalysis): number => Object.values(a.probabilities ?? {}).reduce((s, p) => s + p, 0);

  it.each([
    ['pothole.jpg', 'pothole'],
    ['graffiti.jpg', 'graffiti'],
    ['litter.jpg', 'overflowing_trash'],
  ])(
    'detects %s as %s with high confidence',
    async (file, category) => {
      const a = await analyze(loadDemoImage(file));
      expect(a.quality.ok).toBe(true);
      expect(a.outcome).toBe('detected');
      expect(a.top?.category).toBe(category);
      expect(a.top?.level).toBe('high');
      expect(a.top?.probability).toBeGreaterThanOrEqual(head.def.thresholds.high);
      expect(a.top?.viaRegion).toBe(false);
      expect(a.regionsAnalyzed).toBe(11);
      expect(a.regions).toHaveLength(11);
      expect(totalProbability(a)).toBeCloseTo(1, 5);
      expect(topScores(a.probabilities)[0]?.category).toBe(category);
    },
    MODEL_TIMEOUT_MS,
  );

  it(
    'finds no issue in blocked-sidewalk.jpg',
    async () => {
      const a = await analyze(loadDemoImage('blocked-sidewalk.jpg'));
      expect(a.outcome).toBe('none');
      expect(a.top).toBeUndefined();
      expect(a.probabilities?.none).toBeGreaterThan(0.5);
      expect(totalProbability(a)).toBeCloseTo(1, 5);
    },
    MODEL_TIMEOUT_MS,
  );

  it(
    'explains a pothole detection with visual evidence and a severity estimate',
    async () => {
      const a = await analyze(loadDemoImage('pothole.jpg'));
      const [det] = toDetections(a, modelInfoFor(head), [], new Date('2026-10-06T17:05:00Z'));
      expect(det?.category).toBe('pothole');
      expect(det?.confidenceLevel).toBe('high');
      const visual = det?.evidence.filter((e) => e.kind === 'visual' && e.supports) ?? [];
      expect(visual.length).toBeGreaterThan(0);
      expect(visual.every((e) => e.id.startsWith('ev:pothole:'))).toBe(true);
      expect(det?.explanation.startsWith('Strong visual evidence of a pothole')).toBe(true);
      expect(det?.severity?.score).toBeGreaterThanOrEqual(0);
      expect(det?.severity?.score).toBeLessThanOrEqual(100);
      expect(['low', 'moderate', 'high']).toContain(det?.severity?.level);
      expect(det?.model.backend).toBe('node');
    },
    MODEL_TIMEOUT_MS,
  );

  it(
    'still finds the pothole in live mode with only two crops',
    async () => {
      const a = await analyze(loadDemoImage('pothole.jpg'), 'live');
      expect(a.regionsAnalyzed).toBe(2);
      expect(a.outcome).toBe('detected');
      expect(a.top?.category).toBe('pothole');
    },
    MODEL_TIMEOUT_MS,
  );

  it('rejects a nearly black frame without running the model', async () => {
    if (!backend) throw new Error('model backend failed to load');
    const embed = jest.spyOn(backend, 'embed');
    try {
      const a = await analyze(nearlyBlackFrame());
      expect(a.outcome).toBe('rejected_quality');
      expect(a.regionsAnalyzed).toBe(0);
      expect(a.probabilities).toBeUndefined();
      expect(a.top).toBeUndefined();
      const blocking = a.quality.issues.filter((i) => i.level === 'blocking').map((i) => i.kind);
      expect(blocking.some((k) => k === 'too_dark' || k === 'obstructed')).toBe(true);
      expect(embed).not.toHaveBeenCalled();
    } finally {
      embed.mockRestore();
    }
  });

  it(
    'rejects a heavily blurred pothole photo instead of reporting a confident detection',
    async () => {
      const blurred = boxBlur(loadDemoImage('pothole.jpg'), 4);
      const a = await analyze(blurred);
      expect(a.outcome === 'rejected_quality' || a.top?.level !== 'high').toBe(true);
      // With the current quality thresholds this blur is blocked outright.
      expect(a.outcome).toBe('rejected_quality');
      expect(a.quality.issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'blurry', level: 'blocking' })]));
    },
    MODEL_TIMEOUT_MS,
  );

  it(
    'caps confidence at moderate when the photo is only slightly blurred',
    async () => {
      const a = await analyze(boxBlur(loadDemoImage('pothole.jpg'), 2));
      expect(a.quality.ok).toBe(true);
      expect(a.quality.issues.map((i) => `${i.kind}:${i.level}`)).toContain('blurry:warning');
      expect(a.outcome).toBe('detected');
      expect(a.top?.category).toBe('pothole');
      expect(a.top?.level).toBe('moderate');
    },
    MODEL_TIMEOUT_MS,
  );
});
