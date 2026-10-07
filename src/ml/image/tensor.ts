import type { RgbImage } from './types';

/**
 * Packs square RGB crops into a float32 NCHW tensor with raw 0..255 values.
 * (The exported model applies SigLIP's [-1, 1] scaling internally.)
 */
export const packNchw = (crops: readonly RgbImage[], size: number): Float32Array => {
  const plane = size * size;
  const out = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, n) => {
    if (crop.width !== size || crop.height !== size) {
      throw new Error(`Crop ${n} is ${crop.width}x${crop.height}, expected ${size}x${size}`);
    }
    const base = n * 3 * plane;
    const s = crop.data;
    for (let i = 0, j = 0; i < plane; i++, j += 3) {
      out[base + i] = s[j] as number;
      out[base + plane + i] = s[j + 1] as number;
      out[base + 2 * plane + i] = s[j + 2] as number;
    }
  });
  return out;
};
