/**
 * CivicLens remote inference server (Mode B).
 *
 * Serves the *same* ONNX vision model as the app, through the same adapter,
 * for phones where the on-device runtime is unavailable. Intended for a
 * laptop on the same network during development or a demo — not a
 * production service (no authentication; run it only on a trusted network).
 *
 *   npm run server          # listens on 0.0.0.0:8787
 *   PORT=9000 npm run server
 *
 * Then set EXPO_PUBLIC_REMOTE_INFERENCE_URL=http://<laptop-ip>:8787 and
 * enable "Cloud image analysis" in the app's Settings.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

import { base64ToBytes, bytesToBase64 } from '../src/ml/runtime/remote';
import { EMBEDDING_DIM } from '../src/ml/runtime/ortBackend';
import { createNodeBackend, DEFAULT_MODEL_PATH } from '../tools/ml/nodeBackend';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BATCH = 16;
const MAX_BODY = 16 * 1024 * 1024;

const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const main = async (): Promise<void> => {
  const backend = await createNodeBackend();
  const modelSha = sha256(DEFAULT_MODEL_PATH);

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/health') {
      send(200, { ok: true, model: 'civiclens_vision.onnx (SigLIP 2 B/32)', sha256: modelSha });
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/embed') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        void (async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { batch: number; size: number; pixels: string };
            const { batch, size: side } = body;
            if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH || side !== 256) {
              send(400, { error: 'bad request' });
              return;
            }
            const nhwc = base64ToBytes(body.pixels);
            const plane = side * side;
            if (nhwc.length !== batch * plane * 3) {
              send(400, { error: 'pixel payload size mismatch' });
              return;
            }
            const nchw = new Float32Array(batch * 3 * plane);
            for (let n = 0; n < batch; n++)
              for (let i = 0; i < plane; i++)
                for (let c = 0; c < 3; c++) nchw[n * 3 * plane + c * plane + i] = nhwc[(n * plane + i) * 3 + c] as number;
            const started = Date.now();
            const emb = await backend.embed(nchw, batch);
            console.log(`[Inference] batch=${batch} latency=${Date.now() - started}ms`);
            send(200, { batch, dim: EMBEDDING_DIM, embeddings: bytesToBase64(new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength)) });
          } catch (e) {
            send(500, { error: e instanceof Error ? e.message : 'inference failed' });
          }
        })();
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`CivicLens inference server on :${PORT} (model sha256 ${modelSha.slice(0, 12)}…)`));
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
