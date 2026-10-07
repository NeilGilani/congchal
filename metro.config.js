// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The on-device vision model ships as a bundled asset.
config.resolver.assetExts.push('onnx');

// Node-only code (tests, evaluation tooling, the optional inference server)
// must never end up in the app bundle. Patterns are anchored to this
// project's own folders so dependencies with a `tools/` folder still resolve.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = ['tools', 'server', 'tests'].map(
  (dir) => new RegExp(`^${escape(path.join(__dirname, dir))}[\\/\\\\].*`),
);

module.exports = config;
