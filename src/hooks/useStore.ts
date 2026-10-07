import { useCallback, useEffect, useState } from 'react';

import type { Report } from '@/models/report';
import type { Scan } from '@/models/scan';
import { DEFAULT_SETTINGS, type UserSettings } from '@/models/settings';
import type { Collection } from '@/storage/collection';
import { getRepositories } from '@/storage/repositories';

interface Identified {
  id: string;
}

/** Live list of a persisted collection (re-renders on any change). */
export const useCollectionList = <T extends Identified>(collection: Collection<T>): { items: T[]; loading: boolean } => {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void collection.list().then((list) => {
        if (!alive) return;
        setItems(list);
        setLoading(false);
      });
    };
    load();
    const unsub = collection.subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [collection]);
  return { items, loading };
};

export const useCollectionItem = <T extends Identified>(
  collection: Collection<T>,
  id: string | undefined,
): { item: T | undefined; loading: boolean } => {
  const [loaded, setLoaded] = useState<{ id: string; item: T | undefined } | undefined>();
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () => {
      void collection.get(id).then((v) => {
        if (alive) setLoaded({ id, item: v });
      });
    };
    load();
    const unsub = collection.subscribe(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [collection, id]);
  const current = id !== undefined && loaded?.id === id ? loaded : undefined;
  return { item: current?.item, loading: id !== undefined && !current };
};

/** Finds a scan in the real or demo namespace. */
export const useScan = (id: string | undefined): { scan: Scan | undefined; loading: boolean } => {
  const real = useCollectionItem(getRepositories().scans, id);
  const demo = useCollectionItem(getRepositories().demoScans, id);
  return { scan: real.item ?? demo.item, loading: real.loading || demo.loading };
};

export const useReport = (id: string | undefined): { report: Report | undefined; loading: boolean } => {
  const real = useCollectionItem(getRepositories().reports, id);
  const demo = useCollectionItem(getRepositories().demoReports, id);
  return { report: real.item ?? demo.item, loading: real.loading || demo.loading };
};

export const useReportForScan = (scanId: string | undefined, isDemo: boolean): Report | undefined => {
  const repos = getRepositories();
  const { items } = useCollectionList(isDemo ? repos.demoReports : repos.reports);
  return scanId ? items.find((r) => r.scanId === scanId) : undefined;
};

export const useSettings = (): {
  settings: UserSettings;
  loaded: boolean;
  update: (patch: Partial<UserSettings>) => Promise<UserSettings>;
} => {
  const store = getRepositories().settings;
  const [settings, setSettings] = useState<UserSettings>(store.current() ?? DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(Boolean(store.current()));
  useEffect(() => {
    let alive = true;
    void store.load().then((s) => {
      if (!alive) return;
      setSettings(s);
      setLoaded(true);
    });
    const unsub = store.subscribe(() => {
      const s = store.current();
      if (s && alive) setSettings(s);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [store]);
  const update = useCallback((patch: Partial<UserSettings>) => store.update(patch), [store]);
  return { settings, loaded, update };
};
