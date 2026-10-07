import { Asset } from 'expo-asset';

import type { DemoScenario } from '@/constants/demoScenarios';
import type { Evidence } from '@/models/detection';
import type { GeoFix } from '@/models/location';
import type { Scan } from '@/models/scan';
import type { UserSettings } from '@/models/settings';
import { DetectionService, getHead } from '@/services/detection/detectionService';
import { enrichScan } from '@/services/scan/enrichment';
import { buildScan } from '@/services/scan/scanService';
import { deleteScanImage, persistScanImage } from '@/storage/imageStore';
import { getRepositories } from '@/storage/repositories';
import { newId } from '@/utils/ids';
import { log } from '@/utils/logger';

/** True when the trained model has an output class for this category. */
export const modelCanDetect = (scenario: DemoScenario): boolean =>
  (getHead().classes as readonly string[]).includes(scenario.shows);

/** The sample location stands in for GPS. Accuracy is unknown, not invented. */
export const demoLocation = (scenario: DemoScenario, now = new Date()): GeoFix => ({
  latitude: scenario.location.latitude,
  longitude: scenario.location.longitude,
  accuracy: null,
  timestamp: now.toISOString(),
  source: 'demo',
});

/**
 * Runs a bundled sample photo through exactly the same analysis as a camera
 * scan (native resize, quality gate, on-device model, regions, severity).
 * Nothing about the result is scripted. The scan is stored in the separate
 * demo namespace, so it never appears in real history, impact stats or the
 * duplicate check for real scans.
 */
export const runDemoScenario = async (scenario: DemoScenario, settings: UserSettings): Promise<Scan> => {
  const asset = Asset.fromModule(scenario.image);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = newId('demo');
  const { prepared, analysis, model } = await DetectionService.analyzePhoto(
    uri,
    asset.width ?? undefined,
    asset.height ?? undefined,
    settings,
    'scan',
  );
  const imageUri = await persistScanImage(prepared.uri, id);
  const extra: Evidence[] = [];
  if (analysis.quality.ok && !analysis.quality.issues.length) {
    extra.push({ id: 'quality', kind: 'quality', label: 'Photo is sharp and well exposed', supports: true });
  }
  const scan: Scan = {
    ...buildScan({
      id,
      source: 'demo',
      imageUri,
      width: prepared.width,
      height: prepared.height,
      analysis,
      model,
      location: demoLocation(scenario),
      isDemo: true,
      extraEvidence: extra,
    }),
    demoScenarioId: scenario.id,
  };
  await getRepositories().demoScans.put(scan);
  log.info('Detection', 'demo scan', { scenario: scenario.id, outcome: scan.analysis.outcome });
  if (settings.civicLookupsEnabled && !settings.localOnlyMode) {
    void enrichScan(scan.id, true).catch(() => undefined);
  }
  return scan;
};

export const clearDemoData = async (): Promise<void> => {
  const repos = getRepositories();
  for (const s of await repos.demoScans.list()) deleteScanImage(s.imageUri);
  await repos.demoReports.clear();
  await repos.demoScans.clear();
};
