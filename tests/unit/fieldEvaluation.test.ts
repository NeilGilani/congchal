import type { ModelClass } from '@/models/issue';
import {
  appendFieldRecord,
  clearFieldRecords,
  type FieldPrediction,
  type FieldRecord,
  type FieldTruth,
  loadFieldRecords,
  predictionFor,
  summarizeFieldRecords,
} from '@/services/dev/fieldEvaluation';
import { createMemoryStore } from '@/storage/kv';

/** The classes of the bundled head (assets/models/civiclens-head.json). */
const CLASSES: readonly ModelClass[] = ['none', 'pothole', 'pavement_crack', 'graffiti', 'flooding', 'overflowing_trash', 'illegal_dumping'];

const rec = (truth: FieldTruth, predicted: FieldPrediction, latencyMs: number, confidence = 0.8): FieldRecord => ({
  at: '2026-10-06T17:00:00.000Z',
  truth,
  predicted,
  confidence,
  latencyMs,
});

describe('predictionFor', () => {
  it('maps analysis outcomes onto field predictions', () => {
    expect(predictionFor('rejected_quality', 'pothole')).toBe('rejected');
    expect(predictionFor('uncertain', 'pothole')).toBe('uncertain');
    expect(predictionFor('detected', 'graffiti')).toBe('graffiti');
    expect(predictionFor('detected', undefined)).toBe('none');
    expect(predictionFor('none', undefined)).toBe('none');
  });
});

describe('summarizeFieldRecords', () => {
  const records = [
    rec('pothole', 'pothole', 410),
    rec('pothole', 'pothole', 380),
    rec('pothole', 'pavement_crack', 520),
    rec('pothole', 'uncertain', 450),
    rec('none', 'pothole', 400),
    rec('none', 'none', 390, 0),
    rec('none', 'uncertain', 430),
    rec('graffiti', 'graffiti', 600),
    rec('other_issue', 'graffiti', 470),
    rec('pothole', 'rejected', 90, 0),
    rec('none', 'none', 360, 0),
  ];
  const s = summarizeFieldRecords(records, CLASSES);

  it('counts totals, rejections and uncertain answers', () => {
    expect(s.total).toBe(11);
    expect(s.rejected).toBe(1);
    expect(s.uncertain).toBe(2);
  });

  it('computes accuracy over non-rejected photos, with uncertain counted as wrong', () => {
    // Correct: two potholes, two "none", one graffiti = 5 of 10 scored photos.
    expect(s.accuracy).toBeCloseTo(0.5, 10);
  });

  it('computes the false alarm rate on photos with no issue', () => {
    // 4 no-issue photos; only the one predicted "pothole" is an alarm ("uncertain" is not).
    expect(s.falseAlarmRate).toBeCloseTo(0.25, 10);
  });

  it('computes per-class precision and recall by hand', () => {
    // pothole: TP 2, FP 1 (a "none" photo), FN 2 (one called a crack, one uncertain); the rejected photo is excluded.
    expect(s.perClass.pothole).toEqual({ tp: 2, fp: 1, fn: 2, precision: 2 / 3, recall: 0.5 });
    expect(s.perClass.pavement_crack).toEqual({ tp: 0, fp: 1, fn: 0, precision: 0, recall: undefined });
    // graffiti: one real tag and one false positive on an "other issue" photo.
    expect(s.perClass.graffiti).toEqual({ tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
    expect(s.perClass.flooding).toEqual({ tp: 0, fp: 0, fn: 0, precision: undefined, recall: undefined });
    expect(Object.keys(s.perClass)).not.toContain('none');
  });

  it('reports the median latency over all photos', () => {
    // Sorted: 90 360 380 390 400 [410] 430 450 470 520 600
    expect(s.medianLatencyMs).toBe(410);
  });

  it('leaves rates undefined when there is nothing to measure', () => {
    const empty = summarizeFieldRecords([], CLASSES);
    expect(empty).toMatchObject({ total: 0, rejected: 0, uncertain: 0, accuracy: undefined, falseAlarmRate: undefined, medianLatencyMs: undefined });
    const allRejected = summarizeFieldRecords([rec('pothole', 'rejected', 80)], CLASSES);
    expect(allRejected.accuracy).toBeUndefined();
    expect(allRejected.perClass.pothole).toEqual({ tp: 0, fp: 0, fn: 0, precision: undefined, recall: undefined });
  });
});

describe('field record storage', () => {
  const KEY = 'dev:field-eval:v1';

  it('appends, loads in order and clears', async () => {
    const store = createMemoryStore();
    expect(await loadFieldRecords(store)).toEqual([]);
    await appendFieldRecord(store, rec('pothole', 'pothole', 410));
    const after = await appendFieldRecord(store, rec('none', 'none', 390, 0));
    expect(after.map((r) => r.truth)).toEqual(['pothole', 'none']);
    expect(await loadFieldRecords(store)).toEqual(after);
    expect(JSON.parse(store.dump()[KEY] ?? '[]')).toHaveLength(2);
    await clearFieldRecords(store);
    expect(await loadFieldRecords(store)).toEqual([]);
    expect(store.dump()[KEY]).toBeUndefined();
  });

  it('survives corrupt or foreign data in the store', async () => {
    const store = createMemoryStore();
    await store.setItem(KEY, '{not json');
    expect(await loadFieldRecords(store)).toEqual([]);
    await store.setItem(KEY, JSON.stringify({ truth: 'pothole' }));
    expect(await loadFieldRecords(store)).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', async () => {
    const store = createMemoryStore();
    const good = rec('graffiti', 'graffiti', 600);
    await store.setItem(KEY, JSON.stringify([good, null, 42, { truth: 'pothole' }, { ...good, at: 7 }]));
    expect(await loadFieldRecords(store)).toEqual([good]);
    // Appending after a partially corrupt load rewrites a clean list.
    await appendFieldRecord(store, rec('none', 'none', 300, 0));
    expect(JSON.parse(store.dump()[KEY] ?? '[]')).toHaveLength(2);
  });
});
