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

/** Lazily binds AsyncStorage so pure-logic modules stay testable in Node. */
export const getDefaultStore = (): KeyValueStore => {
  if (!defaultStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default as KeyValueStore;
    defaultStore = AsyncStorage;
  }
  return defaultStore;
};

export const setDefaultStore = (store: KeyValueStore): void => {
  defaultStore = store;
};
