#!/usr/bin/env node
/**
 * Copies the ONNX Runtime Web (WebAssembly) files into public/ort so the web
 * build can load them as static files. They are not bundled by Metro: the
 * runtime loads its WebAssembly glue with a dynamic import() of a URL, which
 * Metro cannot transform. The files come from the installed onnxruntime-web
 * package, so they always match its version. Runs on `npm install`.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILES = ['ort.wasm.min.js', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

let dist;
try {
  // The package's exports map hides package.json; its Node entry lives in dist/.
  dist = path.dirname(require.resolve('onnxruntime-web'));
} catch {
  console.warn('[civiclens] onnxruntime-web is not installed; the web build will not be able to run the model.');
  process.exit(0);
}
const { version } = JSON.parse(fs.readFileSync(path.join(dist, '..', 'package.json'), 'utf8'));
const out = path.join(__dirname, '..', 'public', 'ort');
fs.mkdirSync(out, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(dist, file), path.join(out, file));
fs.writeFileSync(path.join(out, 'version.json'), `${JSON.stringify({ 'onnxruntime-web': version, files: FILES }, null, 2)}\n`);
console.log(`[civiclens] Copied ONNX Runtime Web ${version} to public/ort.`);
