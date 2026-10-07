// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The on-device vision model ships as a bundled asset.
config.resolver.assetExts.push('onnx');

// Node-only code (tests, evaluation tooling, the optional inference server)
// must never end up in the app bundle.
config.resolver.blockList = [/\/tools\/.*/, /\/server\/.*/, /\/tests\/.*/];

module.exports = config;
