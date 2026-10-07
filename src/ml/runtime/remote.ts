import { z } from 'zod';

import { requestJson } from '@/api/http';

import { EMBEDDING_DIM, MODEL_INPUT_SIZE } from './ortBackend';
import type { EmbeddingBackend } from './types';
import { InferenceError } from './types';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
};

export const base64ToBytes = (s: string): Uint8Array => {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i] ?? 'A') << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
};

/** float32 NCHW (0..255) → uint8 NHWC, which is 4x smaller on the wire. */
export const nchwToNhwcBytes = (pixels: Float32Array, batch: number, size: number): Uint8Array => {
  const plane = size * size;
  const out = new Uint8Array(batch * plane * 3);
  for (let n = 0; n < batch; n++) {
    const base = n * 3 * plane;
    for (let i = 0; i < plane; i++) {
      const o = (n * plane + i) * 3;
      out[o] = pixels[base + i] as number;
      out[o + 1] = pixels[base + plane + i] as number;
      out[o + 2] = pixels[base + 2 * plane + i] as number;
    }
  }
  return out;
};

const embedResponse = z.object({ embeddings: z.string(), batch: z.number(), dim: z.literal(EMBEDDING_DIM) });
const healthResponse = z.object({ ok: z.literal(true), model: z.string(), sha256: z.string() });

/**
 * Mode B: the same vision model served by `server/inference-server.ts`
 * (e.g. a laptop on the same Wi-Fi). Only 256x256 crops are sent — never the
 * full-resolution photo, location, or anything else. Used only when the
 * on-device model is unavailable and the user enabled cloud analysis.
 */
export const createRemoteBackend = async (baseUrl: string): Promise<EmbeddingBackend> => {
  const url = baseUrl.replace(/\/+$/, '');
  const health = await requestJson(`${url}/v1/health`, { schema: healthResponse, label: 'Inference server', timeoutMs: 4000, retries: 0 });
  return {
    kind: 'remote',
    description: `Remote inference (${health.model})`,
    async embed(pixels: Float32Array, batch: number): Promise<Float32Array> {
      const body = JSON.stringify({
        batch,
        size: MODEL_INPUT_SIZE,
        pixels: bytesToBase64(nchwToNhwcBytes(pixels, batch, MODEL_INPUT_SIZE)),
      });
      const res = await requestJson(`${url}/v1/embed`, {
        schema: embedResponse,
        label: 'Inference server',
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 20_000,
        retries: 0,
      });
      const bytes = base64ToBytes(res.embeddings);
      if (res.batch !== batch || bytes.length !== batch * EMBEDDING_DIM * 4) {
        throw new InferenceError('Inference server returned an unexpected payload.');
      }
      return new Float32Array(bytes.buffer, bytes.byteOffset, batch * EMBEDDING_DIM);
    },
    async dispose(): Promise<void> {
      // Stateless HTTP client.
    },
  };
};
