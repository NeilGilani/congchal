import type { Report } from '@/models/report';
import type { Scan } from '@/models/scan';
import { DEFAULT_SETTINGS, type UserSettings } from '@/models/settings';

import { Collection } from './collection';
import { getDefaultStore, type KeyValueStore } from './kv';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const isScan = (v: unknown): v is Scan =>
  isObject(v) &&
  typeof v.id === 'string' &&
  typeof v.imageUri === 'string' &&
  typeof v.createdAt === 'string' &&
  Array.isArray(v.detections) &&
  isObject(v.analysis) &&
  isObject(v.quality);

export const isReport = (v: unknown): v is Report =>
  isObject(v) &&
  typeof v.id === 'string' &&
  typeof v.scanId === 'string' &&
  typeof v.category === 'string' &&
  typeof v.description === 'string' &&
  Array.isArray(v.exports);

export interface Repositories {
  scans: Collection<Scan>;
  reports: Collection<Report>;
  /** Demo data lives in its own namespace so it can never mix with real scans. */
  demoScans: Collection<Scan>;
  demoReports: Collection<Report>;
  settings: SettingsStore;
}

export class SettingsStore {
  private value: UserSettings | undefined;
  private listeners = new Set<() => void>();
  private static readonly KEY = 'settings:v1';

  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<UserSettings> {
    if (this.value) return this.value;
    let stored: Partial<UserSettings> = {};
    try {
      const raw = await this.store.getItem(SettingsStore.KEY);
      if (raw) stored = JSON.parse(raw) as Partial<UserSettings>;
    } catch {
      stored = {};
    }
    this.value = { ...DEFAULT_SETTINGS, ...stored };
    return this.value;
  }

  current(): UserSettings | undefined {
    return this.value;
  }

  async update(patch: Partial<UserSettings>): Promise<UserSettings> {
    const next = { ...(await this.load()), ...patch };
    // Local-only mode implies no cloud analysis.
    if (next.localOnlyMode) next.cloudAnalysisEnabled = false;
    this.value = next;
    await this.store.setItem(SettingsStore.KEY, JSON.stringify(next));
    this.listeners.forEach((l) => l());
    return next;
  }

  async reset(): Promise<void> {
    this.value = { ...DEFAULT_SETTINGS };
    await this.store.removeItem(SettingsStore.KEY);
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const createRepositories = (store: KeyValueStore): Repositories => ({
  scans: new Collection<Scan>(store, 'scans:v1', isScan),
  reports: new Collection<Report>(store, 'reports:v1', isReport),
  demoScans: new Collection<Scan>(store, 'demo:scans:v1', isScan),
  demoReports: new Collection<Report>(store, 'demo:reports:v1', isReport),
  settings: new SettingsStore(store),
});

let repos: Repositories | undefined;

export const getRepositories = (): Repositories => {
  if (!repos) repos = createRepositories(getDefaultStore());
  return repos;
};

export const setRepositories = (r: Repositories): void => {
  repos = r;
};

/** Picks the real or demo collections for a record. */
export const scansFor = (isDemo: boolean): Collection<Scan> =>
  isDemo ? getRepositories().demoScans : getRepositories().scans;
export const reportsFor = (isDemo: boolean): Collection<Report> =>
  isDemo ? getRepositories().demoReports : getRepositories().reports;
