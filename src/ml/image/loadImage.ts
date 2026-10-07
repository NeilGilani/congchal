import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { ANALYSIS_LONG_SIDE, EVIDENCE_LONG_SIDE } from './constants';
import { decodeJpeg } from './decode';
import type { RgbImage } from './types';

export interface PreparedImage {
  /** EXIF-normalised evidence JPEG (cache directory). */
  uri: string;
  width: number;
  height: number;
  /** Decoded analysis-resolution pixels. */
  pixels: RgbImage;
}

const resizeTo = async (sourceUri: string, w: number | undefined, h: number | undefined, longSide: number, quality: number) => {
  const ctx = ImageManipulator.manipulate(sourceUri);
  if (w && h) {
    if (Math.max(w, h) > longSide) ctx.resize(w >= h ? { width: longSide } : { height: longSide });
  } else {
    ctx.resize({ width: longSide });
  }
  const rendered = await ctx.renderAsync();
  return rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
};

/**
 * Camera/gallery photo → (1) evidence JPEG and (2) small analysis JPEG, both
 * made by the native image manipulator (applies EXIF orientation, runs off
 * the JS thread). Only the small one is decoded in JS.
 */
export const prepareImage = async (
  sourceUri: string,
  sourceWidth: number | undefined,
  sourceHeight: number | undefined,
  opts: { evidence: boolean } = { evidence: true },
): Promise<PreparedImage> => {
  const analysis = await resizeTo(sourceUri, sourceWidth, sourceHeight, ANALYSIS_LONG_SIDE, 0.9);
  const evidence = opts.evidence ? await resizeTo(sourceUri, sourceWidth, sourceHeight, EVIDENCE_LONG_SIDE, 0.88) : analysis;
  const pixels = decodeJpeg(await new File(analysis.uri).bytes());
  return { uri: evidence.uri, width: evidence.width, height: evidence.height, pixels };
};
