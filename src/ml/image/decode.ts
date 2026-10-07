import { decode } from 'jpeg-js';

import type { RgbImage } from './types';

export class UnsupportedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * Decodes a baseline/progressive JPEG into packed RGB.
 *
 * The camera pipeline always hands us JPEGs that were already downscaled by
 * the native image manipulator (long side <= 1280 px), so pure-JS decoding
 * stays fast and identical on device, in tests and in evaluation tooling.
 */
export const decodeJpeg = (bytes: Uint8Array): RgbImage => {
  if (!isJpeg(bytes)) {
    throw new UnsupportedImageError('Only JPEG images can be analyzed.');
  }
  let raw: { width: number; height: number; data: Uint8Array };
  try {
    raw = decode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: true,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 256,
    });
  } catch (err) {
    throw new UnsupportedImageError(
      `This image could not be decoded (${err instanceof Error ? err.message : 'unknown error'}).`,
    );
  }
  if (raw.width < 32 || raw.height < 32) {
    throw new UnsupportedImageError('This image is too small to analyze.');
  }
  // jpeg-js returns RGB when formatAsRGBA is false; guard against surprises.
  const expected = raw.width * raw.height * 3;
  if (raw.data.length !== expected) {
    throw new UnsupportedImageError('Unexpected pixel layout after decoding.');
  }
  return { width: raw.width, height: raw.height, data: raw.data };
};
