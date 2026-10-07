import { ISSUE_CATEGORIES, type ModelClass } from '@/models/issue';

import { EMBEDDING_DIM } from './runtime/ortBackend';

export interface ConceptDefinition {
  id: string;
  label: string;
  embedding: number[];
  /** Mean / std of cosine similarity over no-issue street scenes (training split). */
  mean: number;
  std: number;
}

export interface HeadDefinition {
  version: string;
  createdAt: string;
  modelName: string;
  modelVersion: string;
  embeddingDim: number;
  classes: ModelClass[];
  weights: number[][];
  bias: number[];
  temperature: number;
  thresholds: { detect: number; high: number; uncertain: number };
  region: { rescueThreshold: number; boxRelative: number; boxMinPeak: number };
  concepts: ConceptDefinition[];
  siglip: { logitScale: number; logitBias: number };
  training: Record<string, unknown>;
}

const isNumArray = (v: unknown, len?: number): v is number[] =>
  Array.isArray(v) && (len === undefined || v.length === len) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Validates a head file so a corrupted or mismatched asset fails loudly instead of producing nonsense. */
export const parseHeadDefinition = (raw: unknown): HeadDefinition => {
  const h = raw as Partial<HeadDefinition>;
  const allowed: readonly string[] = [...ISSUE_CATEGORIES, 'none'];
  if (!h || typeof h !== 'object') throw new Error('Head file is empty.');
  if (h.embeddingDim !== EMBEDDING_DIM) throw new Error('Head embedding size does not match the vision model.');
  if (!Array.isArray(h.classes) || h.classes.length < 2 || !h.classes.every((c) => allowed.includes(c))) {
    throw new Error('Head classes are invalid.');
  }
  if (!Array.isArray(h.weights) || h.weights.length !== h.classes.length || !h.weights.every((w) => isNumArray(w, EMBEDDING_DIM))) {
    throw new Error('Head weights are invalid.');
  }
  if (!isNumArray(h.bias, h.classes.length)) throw new Error('Head bias is invalid.');
  if (typeof h.temperature !== 'number' || h.temperature <= 0) throw new Error('Head temperature is invalid.');
  if (!h.thresholds || !h.region || !h.siglip || !Array.isArray(h.concepts)) throw new Error('Head metadata is incomplete.');
  for (const c of h.concepts) {
    if (!isNumArray(c.embedding, EMBEDDING_DIM) || typeof c.mean !== 'number' || !(c.std > 0)) {
      throw new Error(`Concept ${String(c.id)} is invalid.`);
    }
  }
  return h as HeadDefinition;
};

export type ClassProbabilities = Partial<Record<ModelClass, number>>;

export interface ConceptScore {
  id: string;
  label: string;
  /** Standard score of the cosine similarity vs. no-issue street scenes. */
  z: number;
}

/**
 * Linear classification head over SigLIP 2 embeddings, with temperature-
 * scaled softmax. Weights are packed into Float32Arrays once.
 */
export class CivicHead {
  readonly classes: readonly ModelClass[];
  private readonly W: Float32Array;
  private readonly b: Float32Array;
  private readonly conceptW: Float32Array;

  constructor(readonly def: HeadDefinition) {
    this.classes = def.classes;
    const C = def.classes.length;
    this.W = new Float32Array(C * EMBEDDING_DIM);
    def.weights.forEach((row, i) => this.W.set(row, i * EMBEDDING_DIM));
    this.b = Float32Array.from(def.bias);
    this.conceptW = new Float32Array(def.concepts.length * EMBEDDING_DIM);
    def.concepts.forEach((c, i) => this.conceptW.set(c.embedding, i * EMBEDDING_DIM));
  }

  /** Raw logits for the embedding at `offset` (in floats) inside `emb`. */
  logits(emb: Float32Array, offset = 0): Float32Array {
    const C = this.classes.length;
    const out = new Float32Array(C);
    for (let c = 0; c < C; c++) {
      let s = this.b[c] as number;
      const base = c * EMBEDDING_DIM;
      for (let d = 0; d < EMBEDDING_DIM; d++) s += (this.W[base + d] as number) * (emb[offset + d] as number);
      out[c] = s;
    }
    return out;
  }

  /** Temperature-scaled softmax of (averaged) logits. */
  probabilities(...logitSets: Float32Array[]): ClassProbabilities {
    const C = this.classes.length;
    const mean = new Float32Array(C);
    for (const l of logitSets) for (let c = 0; c < C; c++) mean[c] = (mean[c] as number) + (l[c] as number) / logitSets.length;
    let max = -Infinity;
    for (let c = 0; c < C; c++) max = Math.max(max, (mean[c] as number) / this.def.temperature);
    let sum = 0;
    const exps = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      exps[c] = Math.exp((mean[c] as number) / this.def.temperature - max);
      sum += exps[c] as number;
    }
    const out: ClassProbabilities = {};
    this.classes.forEach((cls, c) => {
      out[cls] = (exps[c] as number) / sum;
    });
    return out;
  }

  concepts(emb: Float32Array, offset = 0): ConceptScore[] {
    return this.def.concepts.map((c, i) => {
      let s = 0;
      const base = i * EMBEDDING_DIM;
      for (let d = 0; d < EMBEDDING_DIM; d++) s += (this.conceptW[base + d] as number) * (emb[offset + d] as number);
      return { id: c.id, label: c.label, z: (s - c.mean) / c.std };
    });
  }
}
