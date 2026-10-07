import { runInThisContext } from 'node:vm';

/**
 * Jest runs each test file in its own VM context, with its own typed-array
 * constructors. onnxruntime-node's native addon allocates output tensors in
 * Node's main realm, so onnxruntime-common's `data instanceof Float32Array`
 * check fails inside Jest ("A float32 tensor's data must be type of function
 * Float32Array()"). Using the main realm's constructors in this context makes
 * both sides agree.
 *
 * Import this module first, before anything that loads onnxruntime-node:
 * onnxruntime-common captures the constructors when it is first evaluated.
 */
const TYPED_ARRAYS = [
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
] as const;

for (const name of TYPED_ARRAYS) {
  Object.defineProperty(globalThis, name, { value: runInThisContext(name), writable: true, configurable: true });
}

export const MAIN_REALM_TYPED_ARRAYS = TYPED_ARRAYS;
