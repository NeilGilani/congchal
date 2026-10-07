import type { KeyValueStore } from './kv';

interface Identified {
  id: string;
}

/**
 * A persisted collection: one key per record plus an ordered index (newest
 * first). Writes are serialised per collection to avoid lost updates when
 * several async flows touch the same record (e.g. analysis + enrichment).
 */
export class Collection<T extends Identified> {
  private queue: Promise<unknown> = Promise.resolve();
  private cache: Map<string, T> | undefined;
  private loading: Promise<Map<string, T>> | undefined;
  private listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyValueStore,
    private readonly namespace: string,
    private readonly validate: (value: unknown) => value is T,
  ) {}

  private indexKey(): string {
    return `${this.namespace}:index`;
  }

  private itemKey(id: string): string {
    return `${this.namespace}:item:${id}`;
  }

  private serial<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Concurrent callers share one read of the store. Two independent reads
   * could otherwise finish after a write and replace the cache with a stale
   * copy, dropping the record that was just added.
   */
  private load(): Promise<Map<string, T>> {
    if (this.cache) return Promise.resolve(this.cache);
    this.loading ??= this.readAll().then(
      (map) => {
        this.cache ??= map;
        this.loading = undefined;
        return this.cache;
      },
      (e: unknown) => {
        this.loading = undefined;
        throw e;
      },
    );
    return this.loading;
  }

  private async readAll(): Promise<Map<string, T>> {
    const map = new Map<string, T>();
    const rawIndex = await this.store.getItem(this.indexKey());
    const ids: unknown = rawIndex ? JSON.parse(rawIndex) : [];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id !== 'string') continue;
        const raw = await this.store.getItem(this.itemKey(id));
        if (!raw) continue;
        try {
          const value: unknown = JSON.parse(raw);
          if (this.validate(value)) map.set(id, value);
        } catch {
          // Corrupt record: skip it rather than failing the whole collection.
        }
      }
    }
    return map;
  }

  private async persistIndex(map: Map<string, T>): Promise<void> {
    await this.store.setItem(this.indexKey(), JSON.stringify([...map.keys()]));
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(): Promise<T[]> {
    return [...(await this.load()).values()];
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.load()).get(id);
  }

  put(value: T): Promise<T> {
    return this.serial(async () => {
      const map = await this.load();
      const isNew = !map.has(value.id);
      if (isNew) {
        // newest first
        const next = new Map<string, T>([[value.id, value], ...map]);
        this.cache = next;
        await this.store.setItem(this.itemKey(value.id), JSON.stringify(value));
        await this.persistIndex(next);
      } else {
        map.set(value.id, value);
        await this.store.setItem(this.itemKey(value.id), JSON.stringify(value));
      }
      this.emit();
      return value;
    });
  }

  update(id: string, fn: (current: T) => T): Promise<T | undefined> {
    return this.serial(async () => {
      const map = await this.load();
      const current = map.get(id);
      if (!current) return undefined;
      const next = fn(current);
      map.set(id, next);
      await this.store.setItem(this.itemKey(id), JSON.stringify(next));
      this.emit();
      return next;
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const map = await this.load();
      if (!map.delete(id)) return;
      await this.store.removeItem(this.itemKey(id));
      await this.persistIndex(map);
      this.emit();
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      const map = await this.load();
      for (const id of map.keys()) await this.store.removeItem(this.itemKey(id));
      map.clear();
      await this.store.removeItem(this.indexKey());
      this.emit();
    });
  }
}
