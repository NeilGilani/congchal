/** Packed 8-bit RGB pixels, row-major, no padding. */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Axis-aligned rectangle in normalised image coordinates (0..1). */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const createRgbImage = (width: number, height: number): RgbImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 3),
});
