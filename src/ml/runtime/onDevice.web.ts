import { Asset } from 'expo-asset';

import { log } from '@/utils/logger';

import manifest from '../../../assets/models/model-manifest.json';
import { createOrtEmbeddingBackend, type OrtModule } from './ortBackend';
import type { EmbeddingBackend } from './types';
import { ModelUnavailableError } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../../assets/models/civiclens_vision.onnx') as number;

/** Served from public/ort (copied from onnxruntime-web by scripts/copy-ort-web.js). */
const ORT_DIR = '/ort/';
const MODEL_CACHE_PREFIX = 'civiclens-model-';
const MODEL_CACHE = `${MODEL_CACHE_PREFIX}${manifest.sha256.slice(0, 16)}`;
const MODEL_CACHE_KEY = '/__civiclens__/civiclens_vision.onnx';

interface OrtWebModule extends OrtModule {
  env: { wasm: { wasmPaths?: string; numThreads?: number; proxy?: boolean } };
}

const loadScript = (src: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });

/**
 * ONNX Runtime Web is loaded as a static script rather than bundled: it
 * fetches its WebAssembly glue with a runtime import() that Metro cannot
 * transform.
 */
const loadOrtWeb = async (): Promise<OrtWebModule> => {
  const g = globalThis as { ort?: OrtWebModule };
  const base = new URL(ORT_DIR, window.location.href).href;
  if (!g.ort) await loadScript(`${base}ort.wasm.min.js`);
  if (!g.ort) throw new Error('ONNX Runtime Web did not initialise');
  g.ort.env.wasm.wasmPaths = base;
  // Threads need a cross-origin isolated page (SharedArrayBuffer); otherwise one.
  g.ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  // Run inference in a Web Worker so a multi-second scan doesn't freeze the page.
  g.ort.env.wasm.proxy = true;
  return g.ort;
};

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Rejects a download that isn't the shipped model (truncated file, wrong version, LFS pointer, ...). */
const verify = async (bytes: Uint8Array): Promise<void> => {
  if (bytes.byteLength !== manifest.bytes) {
    throw new Error(`model file is ${bytes.byteLength} bytes, expected ${manifest.bytes}`);
  }
  if (!globalThis.crypto?.subtle) {
    log.warn('Model', 'sha256 not checked (no SubtleCrypto outside secure contexts)');
    return;
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  if (digest !== manifest.sha256) throw new Error('model file checksum does not match');
};

const openCache = async (): Promise<Cache | undefined> => {
  if (typeof caches === 'undefined') return undefined;
  try {
    // Drop copies of older model versions.
    for (const name of await caches.keys()) {
      if (name.startsWith(MODEL_CACHE_PREFIX) && name !== MODEL_CACHE) await caches.delete(name);
    }
    return await caches.open(MODEL_CACHE);
  } catch {
    return undefined;
  }
};

/**
 * The 114 MB model, downloaded once and kept in Cache Storage (keyed by its
 * SHA-256), so later visits and offline use don't download it again.
 */
const loadModelBytes = async (url: string): Promise<{ bytes: Uint8Array; cached: boolean }> => {
  const cache = await openCache();
  const hit = await cache?.match(MODEL_CACHE_KEY);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (bytes.byteLength === manifest.bytes) return { bytes, cached: true };
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} while downloading the model`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await verify(bytes);
  if (cache) {
    await cache
      .put(MODEL_CACHE_KEY, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream' } }))
      .catch(() => undefined);
  }
  return { bytes, cached: false };
};

let loading: Promise<EmbeddingBackend> | undefined;

/**
 * Browser version of the on-device backend: the same ONNX model and the same
 * adapter, run by ONNX Runtime Web (WebAssembly) in a Web Worker. Photos are
 * analyzed in the browser and are not uploaded.
 */
export const loadOnDeviceBackend = (): Promise<EmbeddingBackend> => {
  loading ??= (async () => {
    const started = Date.now();
    let ort: OrtWebModule;
    try {
      ort = await loadOrtWeb();
    } catch (e) {
      throw new ModelUnavailableError(
        `The in-browser ML runtime could not be loaded (${e instanceof Error ? e.message : 'unknown error'}). Run \`npm install\` so public/ort is created.`,
        'not_installed',
      );
    }
    let model: { bytes: Uint8Array; cached: boolean };
    try {
      const asset = Asset.fromModule(MODEL_ASSET);
      model = await loadModelBytes(asset.uri);
    } catch (e) {
      throw new ModelUnavailableError(
        `The vision model could not be downloaded (${e instanceof Error ? e.message : 'unknown error'}).`,
        'load_failed',
      );
    }
    try {
      const backend = await createOrtEmbeddingBackend(ort, model.bytes, 'browser', { executionProviders: ['wasm'] });
      log.info('Model', 'loaded in browser', {
        latency: Date.now() - started,
        cached: model.cached,
        threads: ort.env.wasm.numThreads ?? 1,
      });
      return { ...backend, description: 'ONNX Runtime Web (WebAssembly, in this browser)' };
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
