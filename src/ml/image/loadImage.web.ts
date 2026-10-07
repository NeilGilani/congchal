import { ANALYSIS_LONG_SIDE } from './constants';
import type { RgbImage } from './types';

export interface PreparedImage {
  /** Evidence JPEG as a data URL (browsers have no app file system). */
  uri: string;
  width: number;
  height: number;
  /** Decoded analysis-resolution pixels. */
  pixels: RgbImage;
}

/**
 * Smaller than the phone's 1280 px evidence copy: in the browser the photo is
 * stored inline as a data URL in the scan record.
 */
export const WEB_EVIDENCE_LONG_SIDE = 1024;
const WEB_EVIDENCE_QUALITY = 0.85;

const fit = (w: number, h: number, longSide: number): { width: number; height: number } => {
  const scale = Math.min(1, longSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
};

/** Decodes any URI the browser can fetch (data:, blob:, same-origin http) and applies EXIF orientation. */
const loadBitmap = async (uri: string): Promise<ImageBitmap> => {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Could not read the photo (HTTP ${res.status}).`);
  return createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
};

const draw = (bitmap: ImageBitmap, width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot process images (no 2D canvas).');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { canvas, ctx };
};

const toRgb = (ctx: CanvasRenderingContext2D, width: number, height: number): RgbImage => {
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    data[j] = rgba[i] as number;
    data[j + 1] = rgba[i + 1] as number;
    data[j + 2] = rgba[i + 2] as number;
  }
  return { width, height, data };
};

/**
 * Browser version of prepareImage: the canvas does the resizing that the
 * native image manipulator does on the phone. The analysis copy has the same
 * 512 px long side, so the model sees the same resolution.
 */
export const prepareImage = async (
  sourceUri: string,
  _sourceWidth: number | undefined,
  _sourceHeight: number | undefined,
  opts: { evidence: boolean } = { evidence: true },
): Promise<PreparedImage> => {
  const bitmap = await loadBitmap(sourceUri);
  try {
    const a = fit(bitmap.width, bitmap.height, ANALYSIS_LONG_SIDE);
    const pixels = toRgb(draw(bitmap, a.width, a.height).ctx, a.width, a.height);
    if (!opts.evidence) return { uri: sourceUri, width: bitmap.width, height: bitmap.height, pixels };
    const e = fit(bitmap.width, bitmap.height, WEB_EVIDENCE_LONG_SIDE);
    const uri = draw(bitmap, e.width, e.height).canvas.toDataURL('image/jpeg', WEB_EVIDENCE_QUALITY);
    return { uri, width: e.width, height: e.height, pixels };
  } finally {
    bitmap.close();
  }
};
