import { Directory, File, Paths } from 'expo-file-system';

import { log } from '@/utils/logger';

const SCAN_DIR = 'scans';

const scanDirectory = (): Directory => {
  const dir = new Directory(Paths.document, SCAN_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
};

/**
 * Copies a (temporary) photo into the app's private document directory so it
 * survives cache eviction. Photos never leave the device unless the user
 * explicitly shares or exports a report.
 */
export const persistScanImage = async (sourceUri: string, scanId: string): Promise<string> => {
  const dest = new File(scanDirectory(), `${scanId}.jpg`);
  if (dest.exists) dest.delete();
  const src = new File(sourceUri);
  await src.copy(dest);
  return dest.uri;
};

export const deleteScanImage = (uri: string): void => {
  try {
    const f = new File(uri);
    if (f.exists && f.uri.includes(`/${SCAN_DIR}/`)) f.delete();
  } catch (e) {
    log.warn('Storage', 'failed to delete image', { error: e instanceof Error ? e.message : 'unknown' });
  }
};

export const readImageBytes = async (uri: string): Promise<Uint8Array> => {
  const f = new File(uri);
  return f.bytes();
};

export const readImageBase64 = async (uri: string): Promise<string> => new File(uri).base64();

export const deleteAllScanImages = (): void => {
  const dir = new Directory(Paths.document, SCAN_DIR);
  if (dir.exists) dir.delete();
};

export const scanImagesSizeBytes = (): number => {
  const dir = new Directory(Paths.document, SCAN_DIR);
  if (!dir.exists) return 0;
  return dir.list().reduce((sum, entry) => (entry instanceof File ? sum + (entry.size ?? 0) : sum), 0);
};
