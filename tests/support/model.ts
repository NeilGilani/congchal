import fs from 'node:fs';
import path from 'node:path';

import headJson from '@/assets/models/civiclens-head.json';
import { CivicHead, parseHeadDefinition } from '@/ml/head';
import { ANALYSIS_LONG_SIDE } from '@/ml/image/constants';
import { decodeJpeg } from '@/ml/image/decode';
import { limitLongSide } from '@/ml/image/resize';
import type { RgbImage } from '@/ml/image/types';
import type { ModelInfo } from '@/models/detection';

import { createNodeBackend, DEFAULT_MODEL_PATH } from '../../tools/ml/nodeBackend';

/**
 * Loads the real model the same way tools/ml/analyze.ts does: the bundled
 * ONNX vision encoder through onnxruntime-node, the bundled head, and the
 * app's own JPEG decoding and resizing. Callers must import
 * `./mainRealmTypedArrays` before this module.
 */
export const MODEL_PATH = DEFAULT_MODEL_PATH;
export const MODEL_AVAILABLE = fs.existsSync(MODEL_PATH);
export const MODEL_MISSING_MESSAGE =
  `Skipping model integration tests: ${path.relative(process.cwd(), MODEL_PATH)} was not found. ` +
  'Run `npm install` (scripts/assemble-model.js assembles it from its parts).';

export const DEMO_DIR = path.join(__dirname, '..', '..', 'assets', 'demo');

export const loadHead = (): CivicHead => new CivicHead(parseHeadDefinition(headJson));

export const createBackend = () => createNodeBackend(MODEL_PATH, 2);

export const modelInfoFor = (head: CivicHead): ModelInfo => ({
  modelName: head.def.modelName,
  modelVersion: head.def.modelVersion,
  headVersion: head.def.version,
  backend: 'node',
});

/** Decodes a bundled demo photo and limits it to the analysis size, as the app does. */
export const loadDemoImage = (file: string): RgbImage =>
  limitLongSide(decodeJpeg(new Uint8Array(fs.readFileSync(path.join(DEMO_DIR, file)))), ANALYSIS_LONG_SIDE);

const boxBlurPass = (img: RgbImage, radius: number, horizontal: boolean): RgbImage => {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          s += data[(yy * w + xx) * 3 + c] as number;
        }
        out[(y * w + x) * 3 + c] = Math.round(s / (2 * radius + 1));
      }
    }
  }
  return { width: w, height: h, data: out };
};

/** Separable box blur (a (2r+1)x(2r+1) mean filter), like camera shake or misfocus. */
export const boxBlur = (img: RgbImage, radius: number): RgbImage => boxBlurPass(boxBlurPass(img, radius, true), radius, false);

/** A nearly black frame with faint sensor noise (lens covered / pocket shot). */
export const nearlyBlackFrame = (width = 640, height = 480, seed = 7): RgbImage => {
  const data = new Uint8Array(width * height * 3);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    data[i] = 6 + Math.floor((s / 4294967296) * 10);
  }
  return { width, height, data };
};
