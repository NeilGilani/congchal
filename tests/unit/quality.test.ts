import type { RgbImage } from '@/ml/image/types';
import { assessQuality, checkImageQuality, measureQuality } from '@/ml/quality';

/** Deterministic pseudo-random generator (LCG) so tests are reproducible. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Natural-ish texture: random blobs plus edges, like pavement. */
const texture = (w: number, h: number, base = 120, amp = 100, seed = 1): RgbImage => {
  const r = rng(seed);
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, base + (r() - 0.5) * amp));
    data[i * 3] = v;
    data[i * 3 + 1] = v;
    data[i * 3 + 2] = v;
  }
  return { width: w, height: h, data };
};

const boxBlur = (img: RgbImage, radius: number): RgbImage => {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            s += data[(yy * w + xx) * 3 + c] as number;
            n++;
          }
        }
        out[(y * w + x) * 3 + c] = s / n;
      }
    }
  }
  return { width: w, height: h, data: out };
};

const solid = (w: number, h: number, v: number): RgbImage => ({ width: w, height: h, data: new Uint8Array(w * h * 3).fill(v) });

describe('image quality gate', () => {
  it('accepts a sharp, well-exposed textured image', () => {
    const report = checkImageQuality(texture(320, 240));
    expect(report.ok).toBe(true);
    expect(report.issues.filter((i) => i.level === 'blocking')).toHaveLength(0);
  });

  it('rejects a heavily blurred version of the same image', () => {
    const sharp = measureQuality(texture(320, 240));
    const blurred = measureQuality(boxBlur(texture(320, 240), 4));
    expect(blurred.sharpness).toBeLessThan(sharp.sharpness / 10);
    const report = assessQuality(blurred);
    expect(report.ok).toBe(false);
  });

  it('rejects a nearly black frame as too dark or obstructed, with guidance', () => {
    const report = checkImageQuality(texture(320, 240, 12, 10));
    expect(report.ok).toBe(false);
    const issue = report.issues.find((i) => i.level === 'blocking');
    expect(['too_dark', 'obstructed']).toContain(issue?.kind);
    expect(issue?.guidance.length).toBeGreaterThan(10);
  });

  it('rejects a blown-out white frame', () => {
    const report = checkImageQuality(solid(320, 240, 255));
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.kind)).toContain('overexposed');
  });

  it('rejects a featureless frame (blank wall / sky)', () => {
    const report = checkImageQuality(solid(320, 240, 140));
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.kind)).toContain('featureless');
  });

  it('warns but does not block in dim light', () => {
    const report = checkImageQuality(texture(320, 240, 40, 60));
    expect(report.issues.some((i) => i.kind === 'too_dark' && i.level === 'warning')).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('rejects tiny images', () => {
    const report = checkImageQuality(texture(120, 90));
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.kind)).toContain('low_resolution');
  });
});
