import headJson from '@/assets/models/civiclens-head.json';
import { appConfig } from '@/constants/config';
import { CivicHead, parseHeadDefinition } from '@/ml/head';
import { prepareImage, type PreparedImage } from '@/ml/image/loadImage';
import { analyzeImage, type ImageAnalysis } from '@/ml/pipeline';
import type { RegionSetName } from '@/ml/regions';
import { loadOnDeviceBackend } from '@/ml/runtime/onDevice';
import { createRemoteBackend } from '@/ml/runtime/remote';
import type { EmbeddingBackend } from '@/ml/runtime/types';
import { ModelUnavailableError } from '@/ml/runtime/types';
import type { ModelInfo } from '@/models/detection';
import type { UserSettings } from '@/models/settings';
import { log } from '@/utils/logger';

export type ModelState = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface ModelStatus {
  state: ModelState;
  backend?: EmbeddingBackend['kind'];
  description?: string;
  error?: string;
  loadMs?: number;
}

export interface PhotoAnalysis {
  prepared: PreparedImage;
  analysis: ImageAnalysis;
  model: ModelInfo;
}

let head: CivicHead | undefined;
export const getHead = (): CivicHead => {
  head ??= new CivicHead(parseHeadDefinition(headJson));
  return head;
};

/**
 * Owns the vision model lifecycle. Prefers on-device inference; falls back to
 * the remote server only if the user allowed cloud analysis, Local-only mode
 * is off, and a server URL is configured. Never fabricates a result: if no
 * backend is available, callers get a ModelUnavailableError to show.
 */
class DetectionServiceImpl {
  private backend: EmbeddingBackend | undefined;
  private loading: Promise<EmbeddingBackend> | undefined;
  private status: ModelStatus = { state: 'idle' };
  private listeners = new Set<() => void>();
  private lastLatencyMs: number | undefined;

  getStatus(): ModelStatus {
    return this.status;
  }

  lastLatency(): number | undefined {
    return this.lastLatencyMs;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private setStatus(s: ModelStatus): void {
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  /** Loads (once) and returns the best allowed backend. */
  ensureBackend(settings: UserSettings): Promise<EmbeddingBackend> {
    if (this.backend) {
      const remoteNoLongerAllowed = this.backend.kind === 'remote' && (settings.localOnlyMode || !settings.cloudAnalysisEnabled);
      if (!remoteNoLongerAllowed) return Promise.resolve(this.backend);
      void this.backend.dispose();
      this.backend = undefined;
    }
    if (this.loading) return this.loading;
    const started = Date.now();
    this.setStatus({ state: 'loading' });
    this.loading = (async () => {
      let onDeviceError: unknown;
      try {
        const b = await loadOnDeviceBackend();
        this.backend = b;
        this.setStatus({ state: 'ready', backend: b.kind, description: b.description, loadMs: Date.now() - started });
        return b;
      } catch (e) {
        onDeviceError = e;
        log.warn('Model', 'on-device unavailable', { error: e instanceof Error ? e.message : 'unknown' });
      }
      const remoteAllowed = !settings.localOnlyMode && settings.cloudAnalysisEnabled && appConfig.remoteInferenceUrl;
      if (remoteAllowed && appConfig.remoteInferenceUrl) {
        try {
          const b = await createRemoteBackend(appConfig.remoteInferenceUrl);
          this.backend = b;
          this.setStatus({ state: 'ready', backend: b.kind, description: b.description, loadMs: Date.now() - started });
          return b;
        } catch (e) {
          log.warn('Model', 'remote unavailable', { error: e instanceof Error ? e.message : 'unknown' });
        }
      }
      const message =
        onDeviceError instanceof Error ? onDeviceError.message : 'The vision model could not be loaded on this device.';
      this.setStatus({ state: 'unavailable', error: message });
      throw onDeviceError instanceof ModelUnavailableError
        ? onDeviceError
        : new ModelUnavailableError(message, 'load_failed');
    })();
    // Clear the in-flight marker either way. The caller handles the rejection;
    // this side chain must not surface it again as an unhandled one.
    const clear = () => {
      this.loading = undefined;
    };
    this.loading.then(clear, clear);
    return this.loading;
  }

  modelInfo(): ModelInfo {
    const h = getHead();
    return {
      modelName: h.def.modelName,
      modelVersion: h.def.modelVersion,
      headVersion: h.def.version,
      backend: this.backend?.kind ?? 'on-device',
    };
  }

  /**
   * Full analysis of a photo: native resize → JS decode → quality gate →
   * multi-region inference. `mode: 'live'` analyses two regions and skips
   * the evidence copy so the camera loop stays responsive.
   */
  async analyzePhoto(
    uri: string,
    width: number | undefined,
    height: number | undefined,
    settings: UserSettings,
    mode: RegionSetName = 'scan',
  ): Promise<PhotoAnalysis> {
    const backend = await this.ensureBackend(settings);
    const prepared = await prepareImage(uri, width, height, { evidence: mode === 'scan' });
    const analysis = await analyzeImage(prepared.pixels, { backend, head: getHead(), mode });
    this.lastLatencyMs = analysis.timings.totalMs;
    log.info('Detection', mode, {
      outcome: analysis.outcome,
      category: analysis.top?.category ?? 'none',
      confidence: analysis.top?.probability ?? 0,
      latency: analysis.timings.totalMs,
      inference: analysis.timings.inferenceMs,
      size: `${prepared.width}x${prepared.height}`,
    });
    return { prepared, analysis, model: this.modelInfo() };
  }
}

export const DetectionService = new DetectionServiceImpl();
