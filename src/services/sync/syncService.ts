import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { AppState } from 'react-native';

import { enrichScan } from '@/services/scan/enrichment';
import { getRepositories } from '@/storage/repositories';
import { log } from '@/utils/logger';

let running = false;

/**
 * Offline queue: scans captured without connectivity keep `pendingLookups`.
 * When the device is online again (or the app returns to the foreground) we
 * complete them. Nothing is ever *submitted* to a government system here —
 * this only fills in address, jurisdiction and duplicate information.
 */
export const processPendingLookups = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  let done = 0;
  try {
    const settings = await getRepositories().settings.load();
    if (settings.localOnlyMode || !settings.civicLookupsEnabled) return 0;
    const net = await getNetworkStateAsync();
    if (net.isConnected === false || net.isInternetReachable === false) return 0;
    const scans = await getRepositories().scans.list();
    for (const s of scans.filter((x) => x.location && x.pendingLookups.length > 0).slice(0, 10)) {
      await enrichScan(s.id, false).catch(() => undefined);
      done++;
    }
    if (done) log.info('Sync', 'processed queue', { count: done });
  } finally {
    running = false;
  }
  return done;
};

/** Starts listeners; returns a cleanup function. */
export const startSyncWorker = (): (() => void) => {
  const net = addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) void processPendingLookups();
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void processPendingLookups();
  });
  void processPendingLookups();
  return () => {
    net.remove();
    app.remove();
  };
};

export const pendingCount = async (): Promise<number> =>
  (await getRepositories().scans.list()).filter((s) => s.location && s.pendingLookups.length > 0).length;
