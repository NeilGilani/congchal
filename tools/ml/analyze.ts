/**
 * Runs the app's analysis pipeline on JPEG files and prints the result.
 * Uses the same model file, head and TypeScript code as the phone.
 *
 *   npx tsx tools/ml/analyze.ts photo1.jpg [photo2.jpg ...] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

import headJson from '../../assets/models/civiclens-head.json';
import { CivicHead, parseHeadDefinition } from '../../src/ml/head';
import { ANALYSIS_LONG_SIDE } from '../../src/ml/image/constants';
import { decodeJpeg } from '../../src/ml/image/decode';
import { limitLongSide } from '../../src/ml/image/resize';
import { analyzeImage, topScores } from '../../src/ml/pipeline';

import { createNodeBackend } from './nodeBackend';

const main = async (): Promise<void> => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const asJson = process.argv.includes('--json');
  if (!files.length) throw new Error('usage: analyze.ts photo.jpg [...] [--json]');
  const head = new CivicHead(parseHeadDefinition(headJson));
  const backend = await createNodeBackend(undefined, 2);
  const results = [];
  for (const file of files) {
    const img = limitLongSide(decodeJpeg(new Uint8Array(fs.readFileSync(file))), ANALYSIS_LONG_SIDE);
    const a = await analyzeImage(img, { backend, head, mode: 'scan' });
    const result = {
      file: path.basename(file),
      outcome: a.outcome,
      top: a.top ? { category: a.top.category, probability: Number(a.top.probability.toFixed(3)), level: a.top.level, viaRegion: a.top.viaRegion } : null,
      scores: topScores(a.probabilities).slice(0, 3).map((s) => `${s.category} ${s.probability.toFixed(3)}`),
      quality: a.quality.issues.map((i) => `${i.kind}:${i.level}`),
      strongestConcepts: [...(a.concepts ?? [])]
        .sort((x, y) => y.z - x.z)
        .slice(0, 4)
        .map((c) => `${c.id} z=${c.z.toFixed(1)}`),
      ms: Math.round(a.timings.totalMs),
    };
    results.push(result);
    if (!asJson) console.log(JSON.stringify(result));
  }
  if (asJson) console.log(JSON.stringify(results, null, 2));
  await backend.dispose();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
