import type { KeyValueStore } from './kv';

interface Entry<T> {
  exp: number;
  v: T;
}

export interface CacheStats {
  hits: number;
  misses: number;
  writes: number;
}

const stats = new Map<string, CacheStats>();
export const getCacheStats = (): ReadonlyMap<string, CacheStats> => stats;

/**
 * Small TTL cache: memory first, then the persistent key-value store, so
 * repeated lookups (reverse geocoding, jurisdiction, nearby reports) are
 * instant and work offline for places the user has already been.
 */
export class TtlCache<T> {
  private memory = new Map<string, Entry<T>>();

  constructor(
    private readonly store: KeyValueStore | undefined,
    private readonly namespace: string,
    private readonly maxMemoryEntries = 100,
  ) {
    if (!stats.has(namespace)) stats.set(namespace, { hits: 0, misses: 0, writes: 0 });
  }

  private s(): CacheStats {
    return stats.get(this.namespace) as CacheStats;
  }

  private key(k: string): string {
    return `cache:${this.namespace}:${k}`;
  }

  async get(k: string, validate?: (v: unknown) => v is T): Promise<T | undefined> {
    const now = Date.now();
    const mem = this.memory.get(k);
    if (mem && mem.exp > now) {
      this.s().hits++;
      return mem.v;
    }
    if (this.store) {
      try {
        const raw = await this.store.getItem(this.key(k));
        if (raw) {
          const parsed = JSON.parse(raw) as Entry<unknown>;
          if (typeof parsed.exp === 'number' && parsed.exp > now && (!validate || validate(parsed.v))) {
            const entry = parsed as Entry<T>;
            this.remember(k, entry);
            this.s().hits++;
            return entry.v;
          }
          await this.store.removeItem(this.key(k));
        }
      } catch {
        // A broken cache entry is just a miss.
      }
    }
    this.s().misses++;
    return undefined;
  }

  async set(k: string, v: T, ttlMs: number): Promise<void> {
    const entry: Entry<T> = { exp: Date.now() + ttlMs, v };
    this.remember(k, entry);
    this.s().writes++;
    if (this.store) {
      try {
        await this.store.setItem(this.key(k), JSON.stringify(entry));
      } catch {
        // Persisting the cache is best-effort.
      }
    }
  }

  private remember(k: string, entry: Entry<T>): void {
    this.memory.delete(k);
    this.memory.set(k, entry);
    if (this.memory.size > this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    if (!this.store) return;
    const keys = await this.store.getAllKeys();
    const prefix = `cache:${this.namespace}:`;
    await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => this.store?.removeItem(k)));
  }
}

export const clearAllCaches = async (store: KeyValueStore): Promise<void> => {
  const keys = await store.getAllKeys();
  await Promise.all(keys.filter((k) => k.startsWith('cache:')).map((k) => store.removeItem(k)));
};
