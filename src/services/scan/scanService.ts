import type { Evidence, ModelInfo } from '@/models/detection';
import type { GeoFix } from '@/models/location';
import type { AnalysisOutcome, Scan, ScanSource } from '@/models/scan';
import type { UserSettings } from '@/models/settings';
import { sceneContext, toDetections, topScores, type ImageAnalysis } from '@/ml/pipeline';
import { DetectionService } from '@/services/detection/detectionService';
import { LocationService } from '@/services/location/locationService';
import { persistScanImage } from '@/storage/imageStore';
import { getRepositories, scansFor } from '@/storage/repositories';
import { newId } from '@/utils/ids';
import { log } from '@/utils/logger';

import { enrichScan } from './enrichment';

export interface BuildScanInput {
  id: string;
  source: ScanSource;
  imageUri: string;
  width: number;
  height: number;
  analysis: ImageAnalysis;
  model: ModelInfo;
  location?: GeoFix;
  isDemo: boolean;
  extraEvidence?: Evidence[];
  now?: Date;
}

/** Pure: assembles a Scan record from pipeline output (tested without native modules). */
export const buildScan = (input: BuildScanInput): Scan => {
  const now = (input.now ?? new Date()).toISOString();
  const a = input.analysis;
  const detections = toDetections(a, input.model, input.extraEvidence ?? [], input.now);
  const outcome: AnalysisOutcome = a.outcome;
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    imageUri: input.imageUri,
    imageWidth: input.width,
    imageHeight: input.height,
    location: input.location,
    quality: {
      ok: a.quality.ok,
      issues: a.quality.issues.map(({ kind, level, message, guidance }) => ({ kind, level, message, guidance })),
      sharpness: a.quality.metrics.sharpness,
      meanLuma: a.quality.metrics.meanLuma,
    },
    analysis: {
      outcome,
      model: input.model,
      latencyMs: a.timings.totalMs,
      inferenceMs: a.timings.inferenceMs,
      regionsAnalyzed: a.regionsAnalyzed,
      imageWidth: input.width,
      imageHeight: input.height,
      topScores: topScores(a.probabilities),
      sceneContext: sceneContext(a.concepts),
    },
    detections,
    confirmedCategory: undefined,
    userReviewed: false,
    status: 'scanned',
    observations: [],
    pendingLookups: input.location ? ['address', 'jurisdiction', 'civic'] : [],
    isDemo: input.isDemo,
  };
};

export interface ScanRequest {
  uri: string;
  width?: number;
  height?: number;
  source: Exclude<ScanSource, 'demo'>;
  settings: UserSettings;
  /** Live-frame confirmations to record as temporal evidence. */
  framesConfirmed?: number;
  /** GPS position embedded in a gallery photo's EXIF (never the current location). */
  exifLocation?: GeoFix;
}

/**
 * Camera/gallery photo → analysis → persisted Scan. Location is requested in
 * parallel with inference so it rarely adds latency. Enrichment (address,
 * jurisdiction, nearby public reports) runs afterwards and never blocks the
 * result screen; offline scans queue it.
 */
export const createScanFromPhoto = async (req: ScanRequest): Promise<Scan> => {
  const id = newId('scan');
  const locationPromise: Promise<GeoFix | undefined> =
    req.settings.attachLocation && req.source !== 'gallery'
      ? LocationService.getCurrentFix(6000).catch(() => undefined)
      : Promise.resolve(undefined);

  const { prepared, analysis, model } = await DetectionService.analyzePhoto(req.uri, req.width, req.height, req.settings, 'scan');
  // A gallery photo may have been taken elsewhere: only its own EXIF position is used.
  const location = req.source === 'gallery' ? req.exifLocation : await locationPromise;
  const imageUri = await persistScanImage(prepared.uri, id);

  const extra: Evidence[] = [];
  if (req.framesConfirmed && req.framesConfirmed >= 2) {
    extra.push({
      id: 'temporal',
      kind: 'temporal',
      label: `Consistent across ${req.framesConfirmed} live frames`,
      supports: true,
    });
  }
  if (analysis.quality.ok && !analysis.quality.issues.length) {
    extra.push({ id: 'quality', kind: 'quality', label: 'Photo is sharp and well exposed', supports: true });
  }

  const scan = buildScan({
    id,
    source: req.source,
    imageUri,
    width: prepared.width,
    height: prepared.height,
    analysis,
    model,
    location,
    isDemo: false,
    extraEvidence: extra,
  });
  await getRepositories().scans.put(scan);
  log.info('Storage', 'scan saved', { outcome: scan.analysis.outcome, hasLocation: Boolean(location) });
  if (scan.location && req.settings.civicLookupsEnabled && !req.settings.localOnlyMode) {
    void enrichScan(scan.id, false).catch(() => undefined);
  }
  return scan;
};

export const updateScan = (scan: Scan, patch: Partial<Scan>): Promise<Scan | undefined> =>
  scansFor(scan.isDemo).update(scan.id, (s) => ({ ...s, ...patch, updatedAt: new Date().toISOString() }));
