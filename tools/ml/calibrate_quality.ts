/**
 * Calibrates the image-quality gate on real photos (training split only).
 *
 * For each photo we measure the quality metrics at the app's analysis
 * resolution, then again after a synthetic Gaussian-like blur (3 passes of a
 * box blur, radius r) and darkening. We report percentiles so thresholds can
 * be chosen to keep ~98% of real photos while rejecting clearly degraded ones.
 *
 *   npx tsx tools/ml/calibrate_quality.ts --dataset dataset.json --data-root DATA --out docs/eval/quality-calibration.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { ANALYSIS_LONG_SIDE } from '../../src/ml/image/constants';
import { decodeJpeg } from '../../src/ml/image/decode';
import { limitLongSide } from '../../src/ml/image/resize';
import type { RgbImage } from '../../src/ml/image/types';
import { measureQuality, type QualityMetrics } from '../../src/ml/quality';

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

const boxBlurPass = (img: RgbImage, r: number): RgbImage => {
  const { width: w, height: h } = img;
  const tmp = new Float32Array(img.data.length);
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += img.data[(y * w + Math.min(w - 1, Math.max(0, x + d))) * 3 + c] as number;
        tmp[(y * w + x) * 3 + c] = s / (2 * r + 1);
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += tmp[(Math.min(h - 1, Math.max(0, y + d)) * w + x) * 3 + c] as number;
        out[(y * w + x) * 3 + c] = Math.round(s / (2 * r + 1));
      }
  return { width: w, height: h, data: out };
};

const blur = (img: RgbImage, r: number): RgbImage => boxBlurPass(boxBlurPass(boxBlurPass(img, r), r), r);

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
};

const main = (): void => {
  const ds = JSON.parse(fs.readFileSync(arg('dataset'), 'utf8')) as { records: { id: string; split: string; label: string }[] };
  const root = arg('data-root');
  const train = ds.records.filter((r) => r.split === 'train');
  // Deterministic sample stratified by source prefix.
  const sample = train.filter((_, i) => i % 6 === 0);
  const original: QualityMetrics[] = [];
  const blurred: Record<string, QualityMetrics[]> = { r1: [], r2: [], r4: [] };
  for (const r of sample) {
    const img = limitLongSide(decodeJpeg(new Uint8Array(fs.readFileSync(imagePath(root, r.id)))), ANALYSIS_LONG_SIDE);
    original.push(measureQuality(img));
    blurred.r1?.push(measureQuality(blur(img, 1)));
    blurred.r2?.push(measureQuality(blur(img, 2)));
    blurred.r4?.push(measureQuality(blur(img, 4)));
  }
  const summary = (ms: QualityMetrics[]) => ({
    n: ms.length,
    sharpness: { p1: pct(ms.map((m) => m.sharpness), 1), p2: pct(ms.map((m) => m.sharpness), 2), p5: pct(ms.map((m) => m.sharpness), 5), p50: pct(ms.map((m) => m.sharpness), 50), p95: pct(ms.map((m) => m.sharpness), 95) },
    meanLuma: { p1: pct(ms.map((m) => m.meanLuma), 1), p2: pct(ms.map((m) => m.meanLuma), 2), p50: pct(ms.map((m) => m.meanLuma), 50) },
    flatCellRatio: { p50: pct(ms.map((m) => m.flatCellRatio), 50), p98: pct(ms.map((m) => m.flatCellRatio), 98), p99: pct(ms.map((m) => m.flatCellRatio), 99) },
    contrast: { p1: pct(ms.map((m) => m.contrast), 1), p2: pct(ms.map((m) => m.contrast), 2) },
    highlightClip: { p99: pct(ms.map((m) => m.highlightClip), 99) },
  });
  const out = {
    analysisLongSide: ANALYSIS_LONG_SIDE,
    original: summary(original),
    blurRadius1: summary(blurred.r1 ?? []),
    blurRadius2: summary(blurred.r2 ?? []),
    blurRadius4: summary(blurred.r4 ?? []),
  };
  fs.writeFileSync(arg('out'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
};

main();
