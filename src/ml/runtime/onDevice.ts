import { Asset } from 'expo-asset';

import { log } from '@/utils/logger';

import { createOrtEmbeddingBackend, type OrtModule } from './ortBackend';
import type { EmbeddingBackend } from './types';
import { ModelUnavailableError } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../../assets/models/civiclens_vision.onnx') as number;

let loading: Promise<EmbeddingBackend> | undefined;

/**
 * Loads the bundled SigLIP 2 vision encoder into ONNX Runtime (on device).
 * The ~114 MB asset is copied out of the app bundle once by expo-asset and
 * the session is created lazily on first use; subsequent calls reuse it.
 */
export const loadOnDeviceBackend = (): Promise<EmbeddingBackend> => {
  loading ??= (async () => {
    const started = Date.now();
    let ort: OrtModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ort = require('onnxruntime-react-native') as OrtModule;
    } catch {
      throw new ModelUnavailableError('The on-device ML runtime is not part of this build.', 'not_installed');
    }
    const asset = Asset.fromModule(MODEL_ASSET);
    try {
      await asset.downloadAsync();
    } catch (e) {
      throw new ModelUnavailableError(
        `The vision model file could not be prepared (${e instanceof Error ? e.message : 'unknown error'}).`,
        'load_failed',
      );
    }
    const uri = asset.localUri ?? asset.uri;
    try {
      const backend = await createOrtEmbeddingBackend(ort, uri, 'on-device', {
        executionProviders: ['cpu'],
        intraOpNumThreads: 4,
      });
      log.info('Model', 'loaded', { latency: Date.now() - started });
      return backend;
    } catch (e) {
      throw new ModelUnavailableError(
        `The vision model failed to load (${e instanceof Error ? e.message : 'unknown error'}).`,
        'load_failed',
      );
    }
  })();
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
};
