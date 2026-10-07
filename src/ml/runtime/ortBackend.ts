import type { InferenceSession, Tensor, TypedTensor } from 'onnxruntime-common';

import type { BackendKind, EmbeddingBackend } from './types';
import { InferenceError } from './types';

export const MODEL_INPUT_SIZE = 256;
export const EMBEDDING_DIM = 768;
const INPUT_NAME = 'pixels';
const OUTPUT_NAME = 'embedding';

/** The subset of an ONNX Runtime package (node / react-native / web) we need. */
export interface OrtModule {
  InferenceSession: { create(path: string, options?: InferenceSession.SessionOptions): Promise<InferenceSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => TypedTensor<'float32'>;
}

/**
 * Wraps an ONNX Runtime session that exposes the CivicLens vision encoder
 * (`pixels` -> `embedding`). Identical on every platform so the evaluation
 * numbers measured in Node describe what runs on the phone.
 */
export const createOrtEmbeddingBackend = async (
  ort: OrtModule,
  modelPath: string,
  kind: BackendKind,
  options: InferenceSession.SessionOptions = {},
): Promise<EmbeddingBackend> => {
  const session = await ort.InferenceSession.create(modelPath, {
    graphOptimizationLevel: 'all',
    ...options,
  });
  if (!session.inputNames.includes(INPUT_NAME) || !session.outputNames.includes(OUTPUT_NAME)) {
    await session.release();
    throw new InferenceError(
      `Unexpected model signature: inputs=${session.inputNames.join(',')} outputs=${session.outputNames.join(',')}`,
    );
  }
  let busy: Promise<unknown> = Promise.resolve();

  return {
    kind,
    description: `ONNX Runtime (${kind})`,
    async embed(pixels: Float32Array, batch: number): Promise<Float32Array> {
      const expected = batch * 3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
      if (pixels.length !== expected) {
        throw new InferenceError(`Expected ${expected} input values, got ${pixels.length}`);
      }
      // ONNX Runtime sessions are not re-entrant on every platform; serialise runs.
      const run = busy.then(async () => {
        const input = new ort.Tensor('float32', pixels, [batch, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
        const out = await session.run({ [INPUT_NAME]: input as Tensor });
        const emb = out[OUTPUT_NAME];
        if (!emb || !(emb.data instanceof Float32Array) || emb.data.length !== batch * EMBEDDING_DIM) {
          throw new InferenceError('Model returned an unexpected output.');
        }
        return emb.data;
      });
      busy = run.catch(() => undefined);
      return run;
    },
    async dispose(): Promise<void> {
      await busy;
      await session.release();
    },
  };
};
