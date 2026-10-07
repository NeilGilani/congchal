import type { KeyValueStore } from './kv';

const DB_NAME = 'civiclens';
const STORE = 'kv';

let db: Promise<IDBDatabase> | undefined;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened.'));
  });

const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  db ??= openDb().catch((e: unknown) => {
    db = undefined;
    throw e;
  });
  const conn = await db;
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted (storage may be full).'));
  });
};

/**
 * Browser key-value store backed by IndexedDB. The web build keeps evidence
 * photos inside scan and report records as data URLs, which would fill
 * localStorage (about 5 MB) after a few scans; IndexedDB's quota is far
 * larger.
 */
export const createIndexedDbStore = (): KeyValueStore => ({
  getItem: async (key) => {
    const value = await run<unknown>('readonly', (s) => s.get(key));
    return typeof value === 'string' ? value : null;
  },
  setItem: async (key, value) => {
    await run('readwrite', (s) => s.put(value, key));
  },
  removeItem: async (key) => {
    await run('readwrite', (s) => s.delete(key));
  },
  getAllKeys: async () => (await run('readonly', (s) => s.getAllKeys())).map(String),
});
