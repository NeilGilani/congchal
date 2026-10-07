/**
 * Computes SigLIP 2 embeddings for a list of images using the *app's own*
 * TypeScript pipeline (JPEG decode -> region crops -> NCHW packing -> ONNX
 * Runtime). Training and evaluation data therefore go through exactly the
 * preprocessing that runs on the phone.
 *
 * Usage:
 *   npx tsx tools/ml/embed.ts --list images.txt --out embeddings --regions scan
 *
 * Writes <out>.f32 (float32, [N, R, 768]) and <out>.json (ids, regions,
 * quality metrics).
 */
import fs from 'node:fs';
import path from 'node:path';

import { decodeJpeg } from '../../src/ml/image/decode';
import { cropToSquare } from '../../src/ml/image/resize';
import { packNchw } from '../../src/ml/image/tensor';
import { measureQuality } from '../../src/ml/quality';
import { REGION_SETS, type RegionSetName } from '../../src/ml/regions';
import { EMBEDDING_DIM, MODEL_INPUT_SIZE } from '../../src/ml/runtime/ortBackend';
import { createNodeBackend } from './nodeBackend';

const arg = (name: string, fallback?: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};

const main = async (): Promise<void> => {
  const list = fs.readFileSync(arg('list'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = arg('out');
  const regionSet = arg('regions', 'scan') as RegionSetName;
  const regions = REGION_SETS[regionSet];
  const backend = await createNodeBackend(undefined, Number(arg('threads', '4')));
  const fd = fs.openSync(`${out}.f32`, 'w');
  const meta: { ids: string[]; failed: string[]; regions: string[]; quality: unknown[] } = {
    ids: [],
    failed: [],
    regions: regions.map((r) => r.id),
    quality: [],
  };
  const t0 = Date.now();
  for (let i = 0; i < list.length; i++) {
    const file = list[i] as string;
    try {
      const img = decodeJpeg(new Uint8Array(fs.readFileSync(file)));
      const crops = regions.map((r) => cropToSquare(img, r.rect, MODEL_INPUT_SIZE));
      const emb = await backend.embed(packNchw(crops, MODEL_INPUT_SIZE), crops.length);
      if (emb.length !== regions.length * EMBEDDING_DIM) throw new Error('bad embedding size');
      fs.writeSync(fd, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength));
      meta.ids.push(path.basename(file));
      meta.quality.push(measureQuality(img));
    } catch (err) {
      meta.failed.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i % 200 === 0) {
      const rate = (i + 1) / ((Date.now() - t0) / 1000);
      console.log(`${i + 1}/${list.length} (${rate.toFixed(1)} img/s)`);
    }
  }
  fs.closeSync(fd);
  fs.writeFileSync(`${out}.json`, JSON.stringify(meta));
  await backend.dispose();
  console.log(`done: ${meta.ids.length} ok, ${meta.failed.length} failed`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
