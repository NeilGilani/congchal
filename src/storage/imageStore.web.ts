/**
 * Browser version of the photo store. There is no app file system on the
 * web, so evidence photos are kept as JPEG data URLs inside the scan record
 * (stored in IndexedDB, see storage/kv.ts). Nothing is uploaded.
 */

const toDataUrl = async (uri: string): Promise<string> => {
  if (uri.startsWith('data:')) return uri;
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
};

export const persistScanImage = async (sourceUri: string, _scanId: string): Promise<string> => toDataUrl(sourceUri);

/** The photo lives inside its scan record and goes away with it. */
export const deleteScanImage = (_uri: string): void => undefined;

export const readImageBytes = async (uri: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(uri)).arrayBuffer());

export const readImageBase64 = async (uri: string): Promise<string> => {
  const dataUrl = await toDataUrl(uri);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
};

export const deleteAllScanImages = (): void => undefined;

/**
 * Not tracked in the browser: photos live inside IndexedDB records, and the
 * origin's storage estimate also counts the cached model. Settings hides the
 * figure when this throws.
 */
export const scanImagesSizeBytes = (): number => {
  throw new Error('Photo storage size is not tracked in the browser.');
};
