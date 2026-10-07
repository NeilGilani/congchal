import type { PublicReport } from '@/models/civic';
import { getRepositories } from '@/storage/repositories';

const registry = new Map<string, PublicReport>();

/** Remembers public reports the app has displayed so detail screens can open them. */
export const rememberPublicReports = (reports: readonly PublicReport[]): void => {
  for (const r of reports) registry.set(r.id, r);
  while (registry.size > 2000) {
    const first = registry.keys().next().value;
    if (first === undefined) break;
    registry.delete(first);
  }
};

export const findPublicReport = async (id: string): Promise<PublicReport | undefined> => {
  const hit = registry.get(id);
  if (hit) return hit;
  // Fall back to reports persisted inside duplicate checks.
  const repos = getRepositories();
  for (const s of [...(await repos.scans.list()), ...(await repos.demoScans.list())]) {
    for (const c of s.duplicateCheck?.candidates ?? []) {
      if (c.report.id === id && c.report.provider !== 'local') return c.report as PublicReport;
    }
  }
  return undefined;
};
