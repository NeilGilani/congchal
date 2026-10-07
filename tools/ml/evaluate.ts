/**
 * Evaluates the shipped CivicLens pipeline on the held-out test split, using
 * the exact TypeScript code the phone runs (quality gate → crops → ONNX model
 * → head → thresholds → evidence region).
 *
 * Usage:
 *   npx tsx tools/ml/evaluate.ts --dataset dataset.json --data-root DATA \
 *       --out docs/eval/results.json [--limit N] [--robustness 25] [--robustness-only]
 *
 * --robustness-only keeps the saved test-split results and recomputes only
 * the synthetic-degradation section.
 */
import fs from 'node:fs';
import path from 'node:path';

import headJson from '../../assets/models/civiclens-head.json';
import { CivicHead, parseHeadDefinition } from '../../src/ml/head';
import { decodeJpeg } from '../../src/ml/image/decode';
import { ANALYSIS_LONG_SIDE } from '../../src/ml/image/constants';
import { limitLongSide } from '../../src/ml/image/resize';
import type { NormalizedRect, RgbImage } from '../../src/ml/image/types';
import { analyzeImage, type ImageAnalysis } from '../../src/ml/pipeline';
import { rectIntersection } from '../../src/ml/regions';
import { createNodeBackend } from './nodeBackend';

interface Rec {
  id: string;
  label: string;
  source: string;
  split: string;
}

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};

const imagePath = (root: string, id: string): string => {
  if (id.startsWith('oi_')) return path.join(root, 'oi', id);
  if (id.startsWith('deepcrack_') || id.startsWith('cfd_')) return path.join(root, 'norm2', id);
  return path.join(root, 'norm', id);
};

/** YOLO-format ground-truth boxes for the pothole dataset. */
const potholeBoxes = (root: string, id: string): NormalizedRect[] => {
  const name = id.replace(/^pothole_/, '').replace(/\.jpg$/, '.txt').replace(/_/g, ' ');
  const file = path.join(root, 'pothole', 'Pothole Dataset', name.replace('Pothole Dataset ', ''));
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length === 5 && p.every(Number.isFinite))
    .map(([, cx, cy, w, h]) => ({ x: (cx as number) - (w as number) / 2, y: (cy as number) - (h as number) / 2, width: w as number, height: h as number }));
};

// ---------------------------------------------------------------------------
// Synthetic degradations for robustness testing (applied to real test photos).

const clone = (img: RgbImage): RgbImage => ({ width: img.width, height: img.height, data: new Uint8Array(img.data) });

const darken = (img: RgbImage, factor: number, gamma: number): RgbImage => {
  const out = clone(img);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round(255 * Math.pow((out.data[i] as number) / 255, gamma) * factor);
  return out;
};

const boxBlur = (img: RgbImage, r: number): RgbImage => {
  const { width: w, height: h } = img;
  const tmp = new Float32Array(img.data.length);
  const out = clone(img);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = Math.min(w - 1, Math.max(0, x + d));
          s += img.data[(y * w + xx) * 3 + c] as number;
          n++;
        }
        tmp[(y * w + x) * 3 + c] = s / n;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let d = -r; d <= r; d++) {
          const yy = Math.min(h - 1, Math.max(0, y + d));
          s += tmp[(yy * w + x) * 3 + c] as number;
          n++;
        }
        out.data[(y * w + x) * 3 + c] = Math.round(s / n);
      }
  return out;
};

/** Covers a third of the frame (left side) with a dark occluder, like a hand or pole. */
const occlude = (img: RgbImage): RgbImage => {
  const out = clone(img);
  const x1 = Math.round(img.width * 0.33);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < x1; x++) out.data.fill(25, (y * img.width + x) * 3, (y * img.width + x) * 3 + 3);
  return out;
};

/** Simulates a farther viewpoint: the scene occupies the central 50% of a mid-grey frame. */
const farther = (img: RgbImage): RgbImage => {
  const out: RgbImage = { width: img.width, height: img.height, data: new Uint8Array(img.data.length).fill(110) };
  const w2 = Math.round(img.width / 2);
  const h2 = Math.round(img.height / 2);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const sx = Math.min(img.width - 1, x * 2);
      const sy = Math.min(img.height - 1, y * 2);
      const dst = ((y + Math.round(h2 / 2)) * img.width + (x + Math.round(w2 / 2))) * 3;
      const src = (sy * img.width + sx) * 3;
      out.data[dst] = img.data[src] as number;
      out.data[dst + 1] = img.data[src + 1] as number;
      out.data[dst + 2] = img.data[src + 2] as number;
    }
  return out;
};

// ---------------------------------------------------------------------------

interface Row {
  id: string;
  label: string;
  outcome: ImageAnalysis['outcome'];
  predicted: string;
  probability: number;
  level?: string;
  hasBox: boolean;
  boxHitsGt?: boolean;
  ms: number;
}

const wilson = (k: number, n: number): [number, number] => {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
};

const main = async (): Promise<void> => {
  const dataset = JSON.parse(fs.readFileSync(arg('dataset'), 'utf8')) as { records: Rec[] };
  const root = arg('data-root');
  const limit = Number(arg('limit', '0'));
  const robustnessPerClass = Number(arg('robustness', '0'));
  const head = new CivicHead(parseHeadDefinition(headJson));
  const supported = new Set(head.classes);
  const backend = await createNodeBackend();

  let test = dataset.records.filter((r) => r.split === 'test');
  if (limit) test = test.slice(0, limit);
  // Rows of the full test-split pass (empty with --robustness-only, which reuses the saved results).
  const rows: Row[] = [];
  const classes = head.classes.filter((c) => c !== 'none');
  const evaluateSplit = async (): Promise<Record<string, unknown>> => {
    let i = 0;
    for (const r of test) {
      const label = supported.has(r.label as never) ? r.label : 'none';
      // Same resolution the app analyses (the phone's native resizer → 512 px long side).
      const img = limitLongSide(decodeJpeg(new Uint8Array(fs.readFileSync(imagePath(root, r.id)))), ANALYSIS_LONG_SIDE);
      const a = await analyzeImage(img, { backend, head, mode: 'scan' });
      const predicted = a.outcome === 'detected' && a.top ? a.top.category : 'none';
      let boxHitsGt: boolean | undefined;
      if (r.label === 'pothole' && predicted === 'pothole') {
        const gts = potholeBoxes(root, r.id);
        if (gts.length && a.top?.region) boxHitsGt = gts.some((g) => a.top?.region && rectIntersection(a.top.region, g));
      }
      rows.push({
        id: r.id,
        label,
        outcome: a.outcome,
        predicted,
        probability: a.top?.probability ?? 0,
        level: a.top?.level,
        hasBox: Boolean(a.top?.region),
        boxHitsGt,
        ms: a.timings.totalMs,
      });
      if (++i % 100 === 0) console.log(`${i}/${test.length}`);
    }

    const perClass: Record<string, unknown> = {};
    for (const c of classes) {
      const tp = rows.filter((x) => x.predicted === c && x.label === c).length;
      const fp = rows.filter((x) => x.predicted === c && x.label !== c).length;
      const fn = rows.filter((x) => x.predicted !== c && x.label === c).length;
      const uncertainHits = rows.filter((x) => x.label === c && x.outcome === 'uncertain').length;
      perClass[c] = {
        support: tp + fn,
        tp,
        fp,
        fn,
        precision: tp + fp ? tp / (tp + fp) : null,
        precisionCi95: wilson(tp, tp + fp),
        recall: tp + fn ? tp / (tp + fn) : null,
        recallCi95: wilson(tp, tp + fn),
        flaggedUncertainInstead: uncertainHits,
      };
    }
    const none = rows.filter((x) => x.label === 'none');
    const falseAlarms = none.filter((x) => x.outcome === 'detected').length;
    const byLevel = (lvl: string) => {
      const d = rows.filter((x) => x.outcome === 'detected' && x.level === lvl);
      const ok = d.filter((x) => x.predicted === x.label).length;
      return { detections: d.length, correct: ok, precision: d.length ? ok / d.length : null, ci95: wilson(ok, d.length) };
    };
    const pot = rows.filter((x) => x.boxHitsGt !== undefined);
    const lat = rows.map((x) => x.ms).sort((a, b) => a - b);

    return {
      evaluatedAt: new Date().toISOString(),
      head: { version: head.def.version, thresholds: head.def.thresholds },
      images: rows.length,
      qualityRejected: rows.filter((x) => x.outcome === 'rejected_quality').length,
      perClass,
      noIssueImages: none.length,
      falseAlarmRate: none.length ? falseAlarms / none.length : null,
      falseAlarmRateCi95: wilson(falseAlarms, none.length),
      noIssueFlaggedUncertain: none.filter((x) => x.outcome === 'uncertain').length,
      confidenceLevels: { high: byLevel('high'), moderate: byLevel('moderate') },
      potholeLocalization: {
        detectedWithBoxAndGt: pot.length,
        boxOverlapsAnnotatedPothole: pot.filter((x) => x.boxHitsGt).length,
      },
      hostLatencyMs: { p50: lat[Math.floor(lat.length * 0.5)], p90: lat[Math.floor(lat.length * 0.9)] },
    };
  };
  const robustnessOnly = process.argv.includes('--robustness-only');
  const results: Record<string, unknown> = robustnessOnly
    ? (JSON.parse(fs.readFileSync(arg('out'), 'utf8')) as Record<string, unknown>)
    : await evaluateSplit();

  // Robustness: real test photos with controlled degradations.
  if (robustnessPerClass > 0) {
    const sample: Rec[] = [];
    for (const c of [...classes, 'none']) {
      sample.push(...test.filter((r) => (supported.has(r.label as never) ? r.label : 'none') === c).slice(0, robustnessPerClass));
    }
    const variants: Record<string, (img: RgbImage) => RgbImage> = {
      original: (x) => x,
      // Exposure: brightness factor and gamma (>1 crushes shadows like a phone sensor in low light).
      evening: (x) => darken(x, 0.45, 1.6),
      night: (x) => darken(x, 0.15, 2.2),
      // Box blur radius in pixels at the 512 px analysis size (2 ≈ slight hand shake, 6 ≈ badly out of focus).
      blur_mild: (x) => boxBlur(x, 2),
      blur: (x) => boxBlur(x, 6),
      occluded: occlude,
      farther,
    };
    const rob: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(variants)) {
      let correct = 0;
      let rejected = 0;
      let falseAlarm = 0;
      let issues = 0;
      let nones = 0;
      for (const r of sample) {
        const label = supported.has(r.label as never) ? r.label : 'none';
        const img = fn(limitLongSide(decodeJpeg(new Uint8Array(fs.readFileSync(imagePath(root, r.id)))), ANALYSIS_LONG_SIDE));
        const a = await analyzeImage(img, { backend, head, mode: 'scan' });
        const pred = a.outcome === 'detected' && a.top ? a.top.category : 'none';
        if (a.outcome === 'rejected_quality') rejected++;
        if (label === 'none') {
          nones++;
          if (a.outcome === 'detected') falseAlarm++;
        } else {
          issues++;
          if (pred === label) correct++;
        }
      }
      rob[name] = {
        images: sample.length,
        rejectedByQualityGate: rejected,
        issueRecall: issues ? correct / issues : null,
        falseAlarmRate: nones ? falseAlarm / nones : null,
      };
      console.log('robustness', name, rob[name]);
    }
    results.robustness = rob;
  }

  fs.mkdirSync(path.dirname(arg('out')), { recursive: true });
  fs.writeFileSync(arg('out'), JSON.stringify(results, null, 2));
  if (!robustnessOnly) fs.writeFileSync(arg('out').replace(/\.json$/, '.rows.json'), JSON.stringify(rows));
  console.log(JSON.stringify(results, null, 2));
  await backend.dispose();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
