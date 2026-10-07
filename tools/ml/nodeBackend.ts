import * as ort from 'onnxruntime-node';
import path from 'node:path';

import { createOrtEmbeddingBackend } from '../../src/ml/runtime/ortBackend';
import type { OrtModule } from '../../src/ml/runtime/ortBackend';
import type { EmbeddingBackend } from '../../src/ml/runtime/types';

export const DEFAULT_MODEL_PATH = path.join(__dirname, '..', '..', 'assets', 'models', 'civiclens_vision.onnx');

/** ONNX Runtime (Node) backend: same model file and adapter as the phone. */
export const createNodeBackend = (modelPath = DEFAULT_MODEL_PATH, threads = 4): Promise<EmbeddingBackend> =>
  createOrtEmbeddingBackend(ort as unknown as OrtModule, modelPath, 'node', {
    intraOpNumThreads: threads,
    executionProviders: ['cpu'],
  });
