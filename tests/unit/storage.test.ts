import { clearAllCaches, getCacheStats, TtlCache } from '@/storage/cache';
import { Collection } from '@/storage/collection';
import { createMemoryStore, type KeyValueStore } from '@/storage/kv';
import { createRepositories } from '@/storage/repositories';

import { makeReport, makeScan } from '../fixtures/records';

interface Note {
  id: string;
  text: string;
  n: number;
}

const isNote = (v: unknown): v is Note =>
  typeof v === 'object' && v !== null && typeof (v as Note).id === 'string' && typeof (v as Note).text === 'string' && typeof (v as Note).n === 'number';

const note = (id: string, n = 0): Note => ({ id, text: `note ${id}`, n });

describe('Collection', () => {
  let store: ReturnType<typeof createMemoryStore>;
  let col: Collection<Note>;

  beforeEach(() => {
    store = createMemoryStore();
    col = new Collection<Note>(store, 'notes:v1', isNote);
  });

  it('puts, gets and lists records newest first', async () => {
    await col.put(note('a'));
    await col.put(note('b'));
    await col.put(note('c'));
    expect((await col.list()).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(await col.get('b')).toEqual(note('b'));
    expect(await col.get('zzz')).toBeUndefined();
    expect(JSON.parse(store.dump()['notes:v1:index'] ?? '[]')).toEqual(['c', 'b', 'a']);
  });

  it('replaces an existing record in place without duplicating it', async () => {
    await col.put(note('a'));
    await col.put(note('b'));
    await col.put({ ...note('a'), text: 'edited' });
    const list = await col.list();
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect(list[1]?.text).toBe('edited');
  });

  it('persists updates so a fresh instance reads them back', async () => {
    await col.put(note('a', 1));
    const updated = await col.update('a', (r) => ({ ...r, n: r.n + 41 }));
    expect(updated?.n).toBe(42);
    const reopened = new Collection<Note>(store, 'notes:v1', isNote);
    expect(await reopened.get('a')).toEqual({ ...note('a'), n: 42 });
  });

  it('returns undefined when updating a missing record and writes nothing', async () => {
    const fn = jest.fn((r: Note) => r);
    expect(await col.update('missing', fn)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    expect(store.dump()).toEqual({});
  });

  it('removes records from the index and the store', async () => {
    await col.put(note('a'));
    await col.put(note('b'));
    await col.remove('a');
    await col.remove('never-existed');
    expect((await col.list()).map((r) => r.id)).toEqual(['b']);
    expect(store.dump()['notes:v1:item:a']).toBeUndefined();
    const reopened = new Collection<Note>(store, 'notes:v1', isNote);
    expect((await reopened.list()).map((r) => r.id)).toEqual(['b']);
  });

  it('clears only its own namespace', async () => {
    const other = new Collection<Note>(store, 'other:v1', isNote);
    await other.put(note('x'));
    await col.put(note('a'));
    await col.clear();
    expect(await col.list()).toEqual([]);
    expect(Object.keys(store.dump()).sort()).toEqual(['other:v1:index', 'other:v1:item:x']);
  });

  it('skips stored records that are corrupt, missing or fail the validator', async () => {
    await store.setItem('notes:v1:index', JSON.stringify(['good', 'wrong-shape', 'corrupt', 'missing', 42]));
    await store.setItem('notes:v1:item:good', JSON.stringify(note('good')));
    await store.setItem('notes:v1:item:wrong-shape', JSON.stringify({ id: 'wrong-shape', text: 7 }));
    await store.setItem('notes:v1:item:corrupt', '{"id": "corrupt", "text": ');
    const reopened = new Collection<Note>(store, 'notes:v1', isNote);
    expect(await reopened.list()).toEqual([note('good')]);
  });

  it('skips stored scans and reports that fail the app\'s own validators', async () => {
    const repos = createRepositories(store);
    await repos.scans.put(makeScan({ id: 'scan_ok' }));
    await repos.reports.put(makeReport({ id: 'rep_ok' }));
    const { detections: _drop, ...noDetections } = makeScan({ id: 'scan_broken' });
    await store.setItem('scans:v1:item:scan_broken', JSON.stringify(noDetections));
    await store.setItem('scans:v1:index', JSON.stringify(['scan_broken', 'scan_ok']));
    await store.setItem('reports:v1:item:rep_broken', JSON.stringify({ ...makeReport({ id: 'rep_broken' }), exports: 'none' }));
    await store.setItem('reports:v1:index', JSON.stringify(['rep_broken', 'rep_ok']));
    const fresh = createRepositories(store);
    expect((await fresh.scans.list()).map((s) => s.id)).toEqual(['scan_ok']);
    expect((await fresh.reports.list()).map((r) => r.id)).toEqual(['rep_ok']);
  });

  it('does not lose records when many writes run concurrently', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    await Promise.all(ids.map((id) => col.put(note(id))));
    expect(await col.list()).toHaveLength(40);
    const reopened = new Collection<Note>(store, 'notes:v1', isNote);
    expect((await reopened.list()).map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it('does not lose updates when the same record is updated concurrently', async () => {
    await col.put(note('counter'));
    await Promise.all(Array.from({ length: 25 }, () => col.update('counter', (r) => ({ ...r, n: r.n + 1 }))));
    expect((await col.get('counter'))?.n).toBe(25);
    const reopened = new Collection<Note>(store, 'notes:v1', isNote);
    expect((await reopened.get('counter'))?.n).toBe(25);
  });

  it('applies concurrent put/update/remove in call order', async () => {
    const results = await Promise.all([
      col.put(note('a')),
      col.update('a', (r) => ({ ...r, text: 'updated' })),
      col.put(note('b')),
      col.remove('b'),
    ]);
    expect(results[1]?.text).toBe('updated');
    expect((await col.list()).map((r) => r.id)).toEqual(['a']);
  });

  it('keeps working after an update callback throws', async () => {
    await col.put(note('a'));
    await expect(
      col.update('a', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await col.put(note('b'));
    expect((await col.list()).map((r) => r.id)).toEqual(['b', 'a']);
    expect((await col.get('a'))?.text).toBe('note a');
  });

  it('notifies subscribers on every change until they unsubscribe', async () => {
    const listener = jest.fn();
    const unsubscribe = col.subscribe(listener);
    await col.put(note('a'));
    await col.update('a', (r) => ({ ...r, n: 1 }));
    await col.remove('a');
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    await col.put(note('b'));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('TtlCache', () => {
  const T0 = Date.parse('2026-10-06T17:00:00Z');
  let namespaceSeq = 0;
  const ns = () => `test-ns-${++namespaceSeq}`;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('serves values until the TTL passes', async () => {
    const cache = new TtlCache<string>(createMemoryStore(), ns());
    await cache.set('37.3382,-121.8863', 'San Jose, CA', 60_000);
    jest.advanceTimersByTime(59_999);
    expect(await cache.get('37.3382,-121.8863')).toBe('San Jose, CA');
    jest.advanceTimersByTime(1);
    expect(await cache.get('37.3382,-121.8863')).toBeUndefined();
  });

  it('reads persisted entries after a restart and deletes expired ones', async () => {
    const store = createMemoryStore();
    const name = ns();
    await new TtlCache<{ city: string }>(store, name).set('fresh', { city: 'San Jose' }, 10_000);
    await new TtlCache<{ city: string }>(store, name).set('stale', { city: 'Old' }, 1_000);
    jest.advanceTimersByTime(5_000);

    const restarted = new TtlCache<{ city: string }>(store, name);
    expect(await restarted.get('fresh')).toEqual({ city: 'San Jose' });
    expect(await restarted.get('stale')).toBeUndefined();
    expect(Object.keys(store.dump())).toEqual([`cache:${name}:fresh`]);
  });

  it('treats a stored value that fails validation as a miss and drops it', async () => {
    const store = createMemoryStore();
    const name = ns();
    await store.setItem(`cache:${name}:k`, JSON.stringify({ exp: T0 + 60_000, v: { city: 42 } }));
    const isCity = (v: unknown): v is { city: string } => typeof (v as { city?: unknown })?.city === 'string';
    const cache = new TtlCache<{ city: string }>(store, name);
    expect(await cache.get('k', isCity)).toBeUndefined();
    expect(store.dump()[`cache:${name}:k`]).toBeUndefined();
  });

  it('treats corrupt stored JSON as a miss', async () => {
    const store = createMemoryStore();
    const name = ns();
    await store.setItem(`cache:${name}:k`, '{"exp":');
    expect(await new TtlCache<string>(store, name).get('k')).toBeUndefined();
  });

  it('evicts the oldest memory entry beyond its capacity but still serves it from the store', async () => {
    const memoryOnly = new TtlCache<number>(undefined, ns(), 2);
    await memoryOnly.set('a', 1, 60_000);
    await memoryOnly.set('b', 2, 60_000);
    await memoryOnly.set('c', 3, 60_000);
    expect(await memoryOnly.get('a')).toBeUndefined();
    expect(await memoryOnly.get('b')).toBe(2);
    expect(await memoryOnly.get('c')).toBe(3);

    const persisted = new TtlCache<number>(createMemoryStore(), ns(), 2);
    await persisted.set('a', 1, 60_000);
    await persisted.set('b', 2, 60_000);
    await persisted.set('c', 3, 60_000);
    expect(await persisted.get('a')).toBe(1);
  });

  it('keeps working in memory when persisting fails', async () => {
    const broken: KeyValueStore = {
      getItem: () => Promise.reject(new Error('disk full')),
      setItem: () => Promise.reject(new Error('disk full')),
      removeItem: () => Promise.reject(new Error('disk full')),
      getAllKeys: () => Promise.resolve([]),
    };
    const cache = new TtlCache<string>(broken, ns());
    await expect(cache.set('k', 'v', 1_000)).resolves.toBeUndefined();
    expect(await cache.get('k')).toBe('v');
    expect(await cache.get('other')).toBeUndefined();
  });

  it('counts hits, misses and writes per namespace', async () => {
    const name = ns();
    const cache = new TtlCache<string>(createMemoryStore(), name);
    await cache.set('k', 'v', 1_000);
    await cache.get('k');
    await cache.get('k');
    await cache.get('nope');
    expect(getCacheStats().get(name)).toEqual({ hits: 2, misses: 1, writes: 1 });
  });

  it('clears its own namespace; clearAllCaches clears every cache but nothing else', async () => {
    const store = createMemoryStore();
    const a = new TtlCache<string>(store, ns());
    const b = new TtlCache<string>(store, ns());
    await a.set('k', 'a', 60_000);
    await b.set('k', 'b', 60_000);
    await store.setItem('scans:v1:index', '[]');

    await a.clear();
    expect(await a.get('k')).toBeUndefined();
    expect(await b.get('k')).toBe('b');

    await clearAllCaches(store);
    expect(Object.keys(store.dump())).toEqual(['scans:v1:index']);
  });
});
