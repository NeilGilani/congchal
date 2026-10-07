import { limitLongSide, toLuma } from './image/resize';
import type { RgbImage } from './image/types';

export type QualityIssueKind =
  | 'blurry'
  | 'too_dark'
  | 'overexposed'
  | 'low_contrast'
  | 'obstructed'
  | 'featureless'
  | 'low_resolution';

export interface QualityIssue {
  kind: QualityIssueKind;
  /** `blocking` issues stop analysis; `warning` issues cap the confidence level. */
  level: 'blocking' | 'warning';
  message: string;
  guidance: string;
}

export interface QualityMetrics {
  /** Variance of the Laplacian on the 320 px analysis plane (higher = sharper). */
  sharpness: number;
  /** Mean luma 0..255. */
  meanLuma: number;
  /** Standard deviation of luma (global contrast). */
  contrast: number;
  /** Fraction of pixels with luma >= 250. */
  highlightClip: number;
  /** Fraction of pixels with luma <= 12. */
  shadowClip: number;
  /** Fraction of 16x16 analysis cells that are nearly uniform. */
  flatCellRatio: number;
  width: number;
  height: number;
}

export interface ImageQualityReport {
  ok: boolean;
  issues: QualityIssue[];
  metrics: QualityMetrics;
}

/**
 * Thresholds. Sharpness thresholds were calibrated with
 * `tools/ml/calibrate_quality.ts` against real photos and the same photos with
 * synthetic Gaussian blur (see docs/EVALUATION.md, "Image quality gate").
 */
export const QUALITY_THRESHOLDS = {
  analysisSide: 320,
  blurBlocking: 18,
  blurWarning: 45,
  darkBlocking: 28,
  darkWarning: 50,
  overexposedClip: 0.45,
  lowContrast: 14,
  flatCellLuma: 3.0,
  featurelessRatio: 0.92,
  obstructedRatio: 0.7,
  obstructedMaxLuma: 70,
  minSide: 240,
} as const;

const laplacianVariance = (luma: Float32Array, w: number, h: number): number => {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        (luma[i - w] as number) +
        (luma[i + w] as number) +
        (luma[i - 1] as number) +
        (luma[i + 1] as number) -
        4 * (luma[i] as number);
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
};

const flatCellRatio = (luma: Float32Array, w: number, h: number, cell: number, threshold: number): number => {
  let flat = 0;
  let total = 0;
  for (let cy = 0; cy + cell <= h; cy += cell) {
    for (let cx = 0; cx + cell <= w; cx += cell) {
      let s = 0;
      let s2 = 0;
      for (let y = cy; y < cy + cell; y++) {
        for (let x = cx; x < cx + cell; x++) {
          const v = luma[y * w + x] as number;
          s += v;
          s2 += v * v;
        }
      }
      const n = cell * cell;
      const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
      if (sd < threshold) flat++;
      total++;
    }
  }
  return total === 0 ? 1 : flat / total;
};

export const measureQuality = (image: RgbImage): QualityMetrics => {
  const small = limitLongSide(image, QUALITY_THRESHOLDS.analysisSide);
  const luma = toLuma(small);
  const n = luma.length;
  let sum = 0;
  let sumSq = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const v = luma[i] as number;
    sum += v;
    sumSq += v * v;
    if (v >= 250) hi++;
    if (v <= 12) lo++;
  }
  const mean = sum / n;
  return {
    sharpness: laplacianVariance(luma, small.width, small.height),
    meanLuma: mean,
    contrast: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    highlightClip: hi / n,
    shadowClip: lo / n,
    flatCellRatio: flatCellRatio(luma, small.width, small.height, 16, QUALITY_THRESHOLDS.flatCellLuma),
    width: image.width,
    height: image.height,
  };
};

export const assessQuality = (metrics: QualityMetrics): ImageQualityReport => {
  const t = QUALITY_THRESHOLDS;
  const issues: QualityIssue[] = [];

  if (Math.min(metrics.width, metrics.height) < t.minSide) {
    issues.push({
      kind: 'low_resolution',
      level: 'blocking',
      message: 'The image is too small to analyze reliably.',
      guidance: 'Use a larger photo or take a new one with the camera.',
    });
  }

  if (metrics.flatCellRatio >= t.obstructedRatio && metrics.meanLuma < t.obstructedMaxLuma) {
    issues.push({
      kind: 'obstructed',
      level: 'blocking',
      message: 'The camera looks covered or blocked.',
      guidance: 'Check that nothing is covering the lens, then try again.',
    });
  } else if (metrics.meanLuma < t.darkBlocking) {
    issues.push({
      kind: 'too_dark',
      level: 'blocking',
      message: 'The photo is too dark to reliably identify an infrastructure issue.',
      guidance: 'Turn on the flashlight or find more light.',
    });
  } else if (metrics.meanLuma < t.darkWarning) {
    issues.push({
      kind: 'too_dark',
      level: 'warning',
      message: 'Low light may reduce accuracy.',
      guidance: 'Turning on the flashlight may help.',
    });
  }

  if (metrics.highlightClip >= t.overexposedClip) {
    issues.push({
      kind: 'overexposed',
      level: 'blocking',
      message: 'Most of the image is washed out by bright light.',
      guidance: 'Avoid pointing at the sun or strong reflections.',
    });
  }

  if (metrics.flatCellRatio >= t.featurelessRatio && !issues.some((i) => i.kind === 'obstructed')) {
    issues.push({
      kind: 'featureless',
      level: 'blocking',
      message: "There isn't enough visible detail to analyze.",
      guidance: 'Move closer and keep the issue centered.',
    });
  } else if (metrics.contrast < t.lowContrast) {
    issues.push({
      kind: 'low_contrast',
      level: 'warning',
      message: 'The scene has very low contrast.',
      guidance: 'Try a different angle or more light.',
    });
  }

  const alreadyBlocked = issues.some((i) => i.level === 'blocking');
  if (!alreadyBlocked) {
    if (metrics.sharpness < t.blurBlocking) {
      issues.push({
        kind: 'blurry',
        level: 'blocking',
        message: 'The photo is too blurry to get a reliable read.',
        guidance: 'Hold the phone steady and tap to focus before scanning.',
      });
    } else if (metrics.sharpness < t.blurWarning) {
      issues.push({
        kind: 'blurry',
        level: 'warning',
        message: 'The photo is slightly blurry.',
        guidance: 'Holding the phone steady will improve accuracy.',
      });
    }
  }

  return { ok: !issues.some((i) => i.level === 'blocking'), issues, metrics };
};

export const checkImageQuality = (image: RgbImage): ImageQualityReport =>
  assessQuality(measureQuality(image));
