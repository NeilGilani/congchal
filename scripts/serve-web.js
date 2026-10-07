#!/usr/bin/env node
/**
 * Serves the exported web app (dist/) on localhost with the headers that make
 * the page cross-origin isolated. Isolation enables SharedArrayBuffer, which
 * lets ONNX Runtime Web run the vision model on several threads (about twice
 * as fast as the single thread available under `npm run web`).
 *
 *   npm run web:local                # export, then serve on http://localhost:8080
 *   PORT=9000 node scripts/serve-web.js dist
 *
 * Development and demo use only: it binds to 127.0.0.1 unless HOST is set.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`[civiclens] ${root}/index.html not found. Run \`npx expo export --platform web\` first.`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Maps a URL path to a file inside root; unknown paths fall back to the single-page app. */
const resolveFile = (urlPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const file = path.resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(root + path.sep)) return undefined;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  return path.extname(decoded) ? undefined : path.join(root, 'index.html');
};

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, ISOLATION).end();
      return;
    }
    const file = resolveFile((req.url || '/').split('?')[0]);
    if (!file) {
      res.writeHead(404, { ...ISOLATION, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const hashed = /[\\/](_expo[\\/]static|assets)[\\/]/.test(file.slice(root.length));
    res.writeHead(200, {
      ...ISOLATION,
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, host, () => {
    console.log(`[civiclens] Serving ${root} at http://${host === '127.0.0.1' ? 'localhost' : host}:${port} (cross-origin isolated)`);
  });
