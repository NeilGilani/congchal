#!/usr/bin/env node
/**
 * Browser smoke test: runs the six Demo Mode photos through the web build in
 * headless Chromium and checks that each result matches the Node pipeline
 * (tools/ml/analyze.ts) on the same file, i.e. that the in-browser model gives
 * the answers the evaluation measured.
 *
 *   npm run web:local            # terminal 1: build and serve on :8080
 *   npm run test:web             # terminal 2 (first time: npx playwright install chromium)
 *   node scripts/web-smoke-test.js http://localhost:8081   # or against `npm run web`
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const SCENARIOS = [
  ['Pothole', 'pothole'],
  ['Damaged sidewalk', 'sidewalk'],
  ['Blocked sidewalk', 'blocked-sidewalk'],
  ['Graffiti', 'graffiti'],
  ['Overflowing trash', 'litter'],
  ['Damaged sign', 'damaged-sign'],
];
/** Browser and Node resize the photo slightly differently (canvas vs JS), so allow a small difference. */
const PROBABILITY_TOLERANCE = 0.03;

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('[civiclens] Playwright is not installed. Run `npm install` and `npx playwright install chromium`.');
  process.exit(1);
}

const nodeResults = () => {
  const files = SCENARIOS.map(([, id]) => path.join('assets', 'demo', `${id}.jpg`));
  // Run tsx through Node itself: `npx` is `npx.cmd` on Windows and can't be spawned without a shell.
  const tsx = require.resolve('tsx/cli');
  const out = execFileSync(process.execPath, [tsx, 'tools/ml/analyze.ts', ...files, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
  const rows = JSON.parse(out.slice(out.indexOf('[')));
  return Object.fromEntries(rows.map((r) => [path.basename(r.file, '.jpg'), r]));
};

const main = async () => {
  console.log('Node pipeline (reference)...');
  const expected = nodeResults();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  } catch {
    throw new Error(`Could not open ${BASE}. Start the app first (npm run web:local).`);
  }
  if (page.url().includes('/onboarding')) {
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Try Demo Mode first' }).click();
  }
  let failures = 0;
  for (const [title, id] of SCENARIOS) {
    const started = Date.now();
    await page.getByRole('button', { name: new RegExp(`Analyze sample photo: ${title}`) }).click();
    await page.waitForURL(/\/result\//, { timeout: 300000 });
    const scanId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop());
    // The web build stores records in IndexedDB (src/storage/indexedDbStore.ts).
    const scan = await page.evaluate(
      (key) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('civiclens');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const req = open.result.transaction('kv', 'readonly').objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result ? JSON.parse(req.result) : null);
            req.onerror = () => reject(req.error);
          };
        }),
      `demo:scans:v1:item:${scanId}`,
    );
    const got = {
      outcome: scan?.analysis?.outcome,
      category: scan?.analysis?.outcome === 'none' ? undefined : scan?.detections?.[0]?.category,
      probability: scan?.detections?.[0]?.confidence,
    };
    const ref = expected[id];
    const want = { outcome: ref.outcome, category: ref.top?.category, probability: ref.top?.probability };
    const ok =
      got.outcome === want.outcome &&
      got.category === want.category &&
      (want.probability === undefined || Math.abs((got.probability ?? 0) - want.probability) <= PROBABILITY_TOLERANCE);
    if (!ok) failures++;
    const fmt = (r) => `${r.outcome}${r.category ? ` ${r.category}` : ''}${r.probability !== undefined ? ` ${r.probability.toFixed(3)}` : ''}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${title.padEnd(18)} browser: ${fmt(got).padEnd(34)} node: ${fmt(want).padEnd(34)} ${Date.now() - started} ms`);
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
  }
  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
  await browser.close();
  if (pageErrors.length) {
    console.log(`Page errors:\n  ${pageErrors.join('\n  ')}`);
    failures++;
  }
  console.log(`${SCENARIOS.length - Math.min(failures, SCENARIOS.length)}/${SCENARIOS.length} match. Threads: ${isolated ? 'multi (cross-origin isolated)' : 'single'}.`);
  process.exit(failures ? 1 : 0);
};

main().catch((e) => {
  console.error(`[civiclens] ${e.message}`);
  process.exit(1);
});
