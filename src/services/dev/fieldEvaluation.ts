import type { AnalysisOutcome } from '@/models/scan';
import type { ModelClass } from '@/models/issue';
import type { KeyValueStore } from '@/storage/kv';

/**
 * Field evaluation: a developer photographs real scenes, the app analyzes
 * them, and the developer records what was actually there. The tally gives
 * on-device precision/recall for real phone photos, which the offline test
 * set (web photos) cannot measure.
 */
export type FieldTruth = ModelClass | 'other_issue';
export type FieldPrediction = ModelClass | 'uncertain' | 'rejected';

export interface FieldRecord {
  at: string;
  truth: FieldTruth;
  predicted: FieldPrediction;
  /** Probability of the predicted class (0 for none/rejected). */
  confidence: number;
  latencyMs: number;
}

export interface FieldClassMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision?: number;
  recall?: number;
}

export interface FieldSummary {
  total: number;
  rejected: number;
  uncertain: number;
  /** Fraction of non-rejected photos where the prediction matched the truth (uncertain counts as wrong). */
  accuracy?: number;
  /** Of photos with no issue, the fraction flagged as an issue. */
  falseAlarmRate?: number;
  perClass: Partial<Record<Exclude<ModelClass, 'none'>, FieldClassMetrics>>;
  medianLatencyMs?: number;
}

export const predictionFor = (outcome: AnalysisOutcome, category: ModelClass | undefined): FieldPrediction => {
  if (outcome === 'rejected_quality') return 'rejected';
  if (outcome === 'uncertain') return 'uncertain';
  if (outcome === 'detected' && category) return category;
  return 'none';
};

const ratio = (a: number, b: number): number | undefined => (b > 0 ? a / b : undefined);

export const summarizeFieldRecords = (records: readonly FieldRecord[], classes: readonly ModelClass[]): FieldSummary => {
  const scored = records.filter((r) => r.predicted !== 'rejected');
  const perClass: FieldSummary['perClass'] = {};
  for (const c of classes) {
    if (c === 'none') continue;
    const tp = scored.filter((r) => r.truth === c && r.predicted === c).length;
    const fp = scored.filter((r) => r.truth !== c && r.predicted === c).length;
    const fn = scored.filter((r) => r.truth === c && r.predicted !== c).length;
    perClass[c] = { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  }
  const noIssue = scored.filter((r) => r.truth === 'none');
  const flagged = noIssue.filter((r) => r.predicted !== 'none' && r.predicted !== 'uncertain').length;
  const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    total: records.length,
    rejected: records.length - scored.length,
    uncertain: scored.filter((r) => r.predicted === 'uncertain').length,
    accuracy: ratio(scored.filter((r) => r.truth === r.predicted).length, scored.length),
    falseAlarmRate: ratio(flagged, noIssue.length),
    perClass,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : undefined,
  };
};

const KEY = 'dev:field-eval:v1';

const isRecord = (v: unknown): v is FieldRecord =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as FieldRecord).truth === 'string' &&
  typeof (v as FieldRecord).predicted === 'string' &&
  typeof (v as FieldRecord).at === 'string';

export const loadFieldRecords = async (store: KeyValueStore): Promise<FieldRecord[]> => {
  try {
    const raw = await store.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

export const appendFieldRecord = async (store: KeyValueStore, record: FieldRecord): Promise<FieldRecord[]> => {
  const next = [...(await loadFieldRecords(store)), record];
  await store.setItem(KEY, JSON.stringify(next));
  return next;
};

export const clearFieldRecords = (store: KeyValueStore): Promise<void> => store.removeItem(KEY);
