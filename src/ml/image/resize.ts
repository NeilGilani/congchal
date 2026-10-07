import type { NormalizedRect, RgbImage } from './types';
import { createRgbImage } from './types';

/**
 * Resamples a source rectangle (in pixels) to `dstW x dstH`.
 *
 * Downscaling uses exact area averaging (a box filter with fractional pixel
 * coverage) so that thin structures such as cracks are not aliased away;
 * upscaling falls back to bilinear interpolation with half-pixel centres.
 */
export const resampleRegion = (
  src: RgbImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dstW: number,
  dstH: number,
): RgbImage => {
  const dst = createRgbImage(dstW, dstH);
  const scaleX = sw / dstW;
  const scaleY = sh / dstH;
  if (scaleX >= 1 && scaleY >= 1) {
    areaResample(src, sx, sy, scaleX, scaleY, dst);
  } else {
    bilinearResample(src, sx, sy, scaleX, scaleY, dst);
  }
  return dst;
};

const areaResample = (
  src: RgbImage,
  sx: number,
  sy: number,
  scaleX: number,
  scaleY: number,
  dst: RgbImage,
): void => {
  const { width: srcW, height: srcH, data: s } = src;
  const d = dst.data;
  // Precompute horizontal coverage spans for every destination column.
  const x0s = new Int32Array(dst.width);
  const x1s = new Int32Array(dst.width);
  const wFirst = new Float32Array(dst.width);
  const wLast = new Float32Array(dst.width);
  for (let dx = 0; dx < dst.width; dx++) {
    const fx0 = sx + dx * scaleX;
    const fx1 = fx0 + scaleX;
    const ix0 = Math.max(0, Math.floor(fx0));
    const ix1 = Math.min(srcW - 1, Math.ceil(fx1) - 1);
    x0s[dx] = ix0;
    x1s[dx] = ix1;
    wFirst[dx] = Math.min(1, ix0 + 1 - fx0);
    wLast[dx] = Math.min(1, fx1 - ix1);
  }
  for (let dy = 0; dy < dst.height; dy++) {
    const fy0 = sy + dy * scaleY;
    const fy1 = fy0 + scaleY;
    const iy0 = Math.max(0, Math.floor(fy0));
    const iy1 = Math.min(srcH - 1, Math.ceil(fy1) - 1);
    for (let dx = 0; dx < dst.width; dx++) {
      const ix0 = x0s[dx] as number;
      const ix1 = x1s[dx] as number;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let y = iy0; y <= iy1; y++) {
        const wy = y === iy0 ? Math.min(1, iy0 + 1 - fy0) : y === iy1 ? Math.min(1, fy1 - iy1) : 1;
        let row = (y * srcW + ix0) * 3;
        for (let x = ix0; x <= ix1; x++) {
          const wx = x === ix0 ? (wFirst[dx] as number) : x === ix1 ? (wLast[dx] as number) : 1;
          const w = wx * wy;
          r += (s[row] as number) * w;
          g += (s[row + 1] as number) * w;
          b += (s[row + 2] as number) * w;
          wsum += w;
          row += 3;
        }
      }
      const o = (dy * dst.width + dx) * 3;
      const inv = wsum > 0 ? 1 / wsum : 0;
      d[o] = Math.round(r * inv);
      d[o + 1] = Math.round(g * inv);
      d[o + 2] = Math.round(b * inv);
    }
  }
};

const bilinearResample = (
  src: RgbImage,
  sx: number,
  sy: number,
  scaleX: number,
  scaleY: number,
  dst: RgbImage,
): void => {
  const { width: srcW, height: srcH, data: s } = src;
  const d = dst.data;
  for (let dy = 0; dy < dst.height; dy++) {
    const fy = Math.min(srcH - 1, Math.max(0, sy + (dy + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const ty = fy - y0;
    for (let dx = 0; dx < dst.width; dx++) {
      const fx = Math.min(srcW - 1, Math.max(0, sx + (dx + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const tx = fx - x0;
      const o = (dy * dst.width + dx) * 3;
      for (let c = 0; c < 3; c++) {
        const a = s[(y0 * srcW + x0) * 3 + c] as number;
        const b = s[(y0 * srcW + x1) * 3 + c] as number;
        const cc = s[(y1 * srcW + x0) * 3 + c] as number;
        const dd = s[(y1 * srcW + x1) * 3 + c] as number;
        const top = a + (b - a) * tx;
        const bottom = cc + (dd - cc) * tx;
        d[o + c] = Math.round(top + (bottom - top) * ty);
      }
    }
  }
};

/** Resizes the whole image (aspect ratio is not preserved). */
export const resizeImage = (src: RgbImage, dstW: number, dstH: number): RgbImage =>
  resampleRegion(src, 0, 0, src.width, src.height, dstW, dstH);

/** Resizes so the longest side is at most `maxSide`, preserving aspect ratio. */
export const limitLongSide = (src: RgbImage, maxSide: number): RgbImage => {
  const long = Math.max(src.width, src.height);
  if (long <= maxSide) return src;
  const scale = maxSide / long;
  return resizeImage(
    src,
    Math.max(1, Math.round(src.width * scale)),
    Math.max(1, Math.round(src.height * scale)),
  );
};

/** Crops a normalised rectangle and resamples it to a square model input. */
export const cropToSquare = (src: RgbImage, rect: NormalizedRect, size: number): RgbImage =>
  resampleRegion(
    src,
    rect.x * src.width,
    rect.y * src.height,
    rect.width * src.width,
    rect.height * src.height,
    size,
    size,
  );

/** Converts packed RGB to a luma plane (Rec. 601), values 0..255. */
export const toLuma = (src: RgbImage): Float32Array => {
  const n = src.width * src.height;
  const out = new Float32Array(n);
  const s = src.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    out[i] = 0.299 * (s[j] as number) + 0.587 * (s[j + 1] as number) + 0.114 * (s[j + 2] as number);
  }
  return out;
};
