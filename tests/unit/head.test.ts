import headJson from '@/assets/models/civiclens-head.json';
import { CivicHead, parseHeadDefinition, type HeadDefinition } from '@/ml/head';
import { EMBEDDING_DIM } from '@/ml/runtime/ortBackend';

const D = EMBEDDING_DIM;
const zeros = (): number[] => new Array<number>(D).fill(0);
const oneHot = (i: number, value = 1): number[] => {
  const v = zeros();
  v[i] = value;
  return v;
};

/** Small hand-checkable head: three classes, each reading one embedding dimension. */
const syntheticHead = (temperature = 0.5): HeadDefinition => ({
  version: 'test',
  createdAt: '2026-10-06T00:00:00Z',
  modelName: 'synthetic',
  modelVersion: 'synthetic',
  embeddingDim: D,
  classes: ['none', 'pothole', 'graffiti'],
  weights: [oneHot(0, 1), oneHot(1, 2), oneHot(2, -1)],
  bias: [0, 0.5, 0],
  temperature,
  thresholds: { detect: 0.55, high: 0.9, uncertain: 0.35 },
  region: { rescueThreshold: 0.9, boxRelative: 0.6, boxMinPeak: 0.55 },
  concepts: [{ id: 'hz:large', label: 'Defect appears large', embedding: oneHot(0), mean: 0.1, std: 0.05 }],
  siglip: { logitScale: 1, logitBias: 0 },
  training: {},
});

const embedding = (values: Record<number, number>): Float32Array => {
  const e = new Float32Array(D);
  for (const [i, v] of Object.entries(values)) e[Number(i)] = v;
  return e;
};

/** Deterministic unit-length pseudo-random embedding. */
const randomUnitEmbedding = (seed: number): Float32Array => {
  const e = new Float32Array(D);
  let s = seed;
  let norm = 0;
  for (let i = 0; i < D; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    e[i] = s / 4294967296 - 0.5;
    norm += (e[i] as number) ** 2;
  }
  return e.map((v) => v / Math.sqrt(norm));
};

const sum = (p: Partial<Record<string, number>>): number => Object.values(p).reduce<number>((a, b) => a + (b ?? 0), 0);

describe('parseHeadDefinition', () => {
  it('accepts the bundled head', () => {
    const def = parseHeadDefinition(headJson);
    expect(def.classes).toEqual(['none', 'pothole', 'pavement_crack', 'graffiti', 'flooding', 'overflowing_trash', 'illegal_dumping']);
    expect(def.weights).toHaveLength(def.classes.length);
    expect(def.temperature).toBeGreaterThan(0);
    expect(def.concepts.length).toBeGreaterThan(20);
  });

  const valid = syntheticHead();
  it.each<[string, unknown, RegExp]>([
    ['null', null, /empty/],
    ['a string', 'not a head', /empty/],
    ['a different embedding size', { ...valid, embeddingDim: 512 }, /embedding size/],
    ['a single class', { ...valid, classes: ['none'], weights: [zeros()], bias: [0] }, /classes/],
    ['an unknown class', { ...valid, classes: ['none', 'pothole', 'banana'] }, /classes/],
    ['a missing weight row', { ...valid, weights: valid.weights.slice(0, 2) }, /weights/],
    ['a short weight row', { ...valid, weights: [zeros(), zeros().slice(1), zeros()] }, /weights/],
    ['a NaN weight', { ...valid, weights: [zeros(), oneHot(3, Number.NaN), zeros()] }, /weights/],
    ['a bias of the wrong length', { ...valid, bias: [0, 0] }, /bias/],
    ['a non-finite bias', { ...valid, bias: [0, Number.POSITIVE_INFINITY, 0] }, /bias/],
    ['a zero temperature', { ...valid, temperature: 0 }, /temperature/],
    ['a string temperature', { ...valid, temperature: '0.64' }, /temperature/],
    ['missing thresholds', { ...valid, thresholds: undefined }, /incomplete/],
    ['concepts that are not a list', { ...valid, concepts: {} }, /incomplete/],
    ['a concept with zero spread', { ...valid, concepts: [{ ...valid.concepts[0], std: 0 }] }, /Concept hz:large/],
    ['a concept with a short embedding', { ...valid, concepts: [{ ...valid.concepts[0], embedding: [1, 2, 3] }] }, /Concept hz:large/],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseHeadDefinition(raw)).toThrow(message);
  });
});

describe('CivicHead math (synthetic head)', () => {
  const head = new CivicHead(parseHeadDefinition(syntheticHead()));
  const e = embedding({ 0: 0.2, 1: 0.3, 2: 0.4 });

  it('computes logits as W·e + b', () => {
    const l = head.logits(e);
    expect(l[0]).toBeCloseTo(0.2, 6);
    expect(l[1]).toBeCloseTo(0.3 * 2 + 0.5, 6);
    expect(l[2]).toBeCloseTo(-0.4, 6);
  });

  it('applies the temperature before the softmax (values computed independently with Python)', () => {
    const p = head.probabilities(head.logits(e));
    expect(p.none).toBeCloseTo(0.13603884344573755, 6);
    expect(p.pothole).toBeCloseTo(0.822987044313176, 6);
    expect(p.graffiti).toBeCloseTo(0.040974112241086366, 6);
    expect(sum(p)).toBeCloseTo(1, 10);
  });

  it('averages logits (not probabilities) across views', () => {
    const second = Float32Array.from([1.0, 0.0, 0.5]);
    const p = head.probabilities(head.logits(e), second);
    expect(p.none).toBeCloseTo(0.44688573119558805, 6);
    expect(p.pothole).toBeCloseTo(0.40435893117212784, 6);
    expect(p.graffiti).toBeCloseTo(0.14875533763228407, 6);
  });

  it('sharpens with a lower temperature and flattens with a higher one', () => {
    const top = (t: number) => {
      const h = new CivicHead(syntheticHead(t));
      return h.probabilities(h.logits(e)).pothole ?? 0;
    };
    expect(top(0.25)).toBeGreaterThan(top(0.5));
    expect(top(0.5)).toBeGreaterThan(top(1));
    expect(top(1000)).toBeCloseTo(1 / 3, 2);
  });

  it('stays finite for very large logits', () => {
    const p = head.probabilities(Float32Array.from([1000, 1001, -1000]));
    expect(sum(p)).toBeCloseTo(1, 10);
    expect(p.pothole).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  });

  it('reads the embedding at the given offset of a batch', () => {
    const batch = new Float32Array(2 * D);
    batch.set(embedding({ 1: 1 }), 0);
    batch.set(e, D);
    expect(Array.from(head.logits(batch, D))).toEqual(Array.from(head.logits(e)));
  });

  it('scores concepts as z = (cosine - mean) / std', () => {
    const [large] = head.concepts(e);
    expect(large?.id).toBe('hz:large');
    expect(large?.z).toBeCloseTo((0.2 - 0.1) / 0.05, 5);
  });
});

describe('CivicHead with the bundled head', () => {
  const head = new CivicHead(parseHeadDefinition(headJson));

  it('produces a probability distribution over its classes for any embedding', () => {
    for (const seed of [1, 2, 3, 42, 1234]) {
      const p = head.probabilities(head.logits(randomUnitEmbedding(seed)));
      expect(Object.keys(p).sort()).toEqual([...head.classes].sort());
      expect(sum(p)).toBeCloseTo(1, 6);
      for (const v of Object.values(p)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('matches a direct computation of softmax((W·e + b) / T)', () => {
    const e = randomUnitEmbedding(7);
    const def = head.def;
    const logits = def.weights.map((row, c) => row.reduce((s, w, d) => s + w * (e[d] as number), def.bias[c] as number));
    const scaled = logits.map((l) => l / def.temperature);
    const max = Math.max(...scaled);
    const exps = scaled.map((z) => Math.exp(z - max));
    const total = exps.reduce((a, b) => a + b, 0);
    const p = head.probabilities(head.logits(e));
    def.classes.forEach((cls, i) => expect(p[cls]).toBeCloseTo((exps[i] as number) / total, 4));
  });

  it('scores every concept probe', () => {
    const scores = head.concepts(randomUnitEmbedding(3));
    expect(scores.map((c) => c.id)).toEqual(head.def.concepts.map((c) => c.id));
    expect(scores.every((c) => Number.isFinite(c.z))).toBe(true);
  });
});
