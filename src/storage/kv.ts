import { Platform } from 'react-native';

/** Minimal async key-value interface (AsyncStorage on device, in-memory in tests). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

export const createMemoryStore = (): KeyValueStore & { dump(): Record<string, string> } => {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
    getAllKeys: async () => [...map.keys()],
    dump: () => Object.fromEntries(map),
  };
};

let defaultStore: KeyValueStore | undefined;

/**
 * Lazily binds AsyncStorage so pure-logic modules stay testable in Node. In
 * a browser, IndexedDB is used instead (AsyncStorage's localStorage is too
 * small for records that carry photos).
 */
export const getDefaultStore = (): KeyValueStore => {
  if (!defaultStore) {
    if (Platform.OS === 'web' && typeof indexedDB !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      defaultStore = (require('./indexedDbStore') as typeof import('./indexedDbStore')).createIndexedDbStore();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      defaultStore = require('@react-native-async-storage/async-storage').default as KeyValueStore;
    }
  }
  return defaultStore;
};

export const setDefaultStore = (store: KeyValueStore): void => {
  defaultStore = store;
};
