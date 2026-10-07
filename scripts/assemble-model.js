#!/usr/bin/env node
/**
 * Reassembles the on-device vision model from the parts committed under
 * assets/models (GitHub rejects single files over 100 MB) and verifies its
 * SHA-256 against model-manifest.json. Runs automatically on `npm install`.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'assets', 'models');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'model-manifest.json'), 'utf8'));
const target = path.join(dir, manifest.file);

const sha256 = (file) => {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return hash.digest('hex');
};

if (fs.existsSync(target) && fs.statSync(target).size === manifest.bytes && sha256(target) === manifest.sha256) {
  console.log(`[civiclens] ${manifest.file} is up to date.`);
  process.exit(0);
}

const missing = manifest.parts.filter((p) => !fs.existsSync(path.join(dir, p)));
if (missing.length > 0) {
  console.error(`[civiclens] Missing model parts: ${missing.join(', ')}. See tools/ml/README.md.`);
  process.exit(1);
}

const tmp = `${target}.tmp`;
const out = fs.openSync(tmp, 'w');
for (const part of manifest.parts) {
  fs.writeSync(out, fs.readFileSync(path.join(dir, part)));
}
fs.closeSync(out);

const digest = sha256(tmp);
if (digest !== manifest.sha256) {
  fs.unlinkSync(tmp);
  console.error(`[civiclens] Model checksum mismatch (got ${digest}). Re-clone or re-run tools/ml/export_onnx.py.`);
  process.exit(1);
}
fs.renameSync(tmp, target);
console.log(`[civiclens] Assembled ${manifest.file} (${(manifest.bytes / 1e6).toFixed(1)} MB, sha256 verified).`);
