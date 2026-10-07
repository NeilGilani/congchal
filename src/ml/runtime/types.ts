export type BackendKind = 'on-device' | 'browser' | 'remote' | 'node';

/**
 * Something that turns a batch of 256x256 RGB crops into SigLIP 2 image
 * embeddings. Implementations: ONNX Runtime on device (React Native), ONNX
 * Runtime Web in the browser (WebAssembly), ONNX Runtime in Node (tests,
 * evaluation, the optional inference server) and an HTTP client for the
 * remote server.
 */
export interface EmbeddingBackend {
  readonly kind: BackendKind;
  readonly description: string;
  /**
   * @param pixels float32 NCHW, values 0..255, shape [batch, 3, 256, 256]
   * @returns float32 [batch, 768], L2-normalised
   */
  embed(pixels: Float32Array, batch: number): Promise<Float32Array>;
  dispose(): Promise<void>;
}

export class ModelUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_installed' | 'load_failed' | 'disabled' | 'unreachable',
  ) {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

export class InferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InferenceError';
  }
}
