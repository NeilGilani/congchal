import type { NormalizedRect } from './image/types';

export interface AnalysisRegion {
  id: string;
  rect: NormalizedRect;
  kind: 'full' | 'center' | 'grid';
}

const FULL: AnalysisRegion = { id: 'full', kind: 'full', rect: { x: 0, y: 0, width: 1, height: 1 } };
const CENTER: AnalysisRegion = {
  id: 'center',
  kind: 'center',
  rect: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
};

/** 3x3 grid of half-size windows with 50% overlap (stride 0.25). */
const GRID: AnalysisRegion[] = [0, 0.25, 0.5].flatMap((y, r) =>
  [0, 0.25, 0.5].map((x, c) => ({
    id: `g${r}${c}`,
    kind: 'grid' as const,
    rect: { x, y, width: 0.5, height: 0.5 },
  })),
);

/**
 * `scan` = full frame + center + 3x3 grid (11 crops) for a deliberate scan;
 * `live` = full frame + center (2 crops) for the continuous camera loop.
 */
export const REGION_SETS = {
  scan: [FULL, CENTER, ...GRID],
  live: [FULL, CENTER],
} as const satisfies Record<string, readonly AnalysisRegion[]>;

export type RegionSetName = keyof typeof REGION_SETS;

export const rectArea = (r: NormalizedRect): number => r.width * r.height;

export const rectUnion = (rects: readonly NormalizedRect[]): NormalizedRect | undefined => {
  if (rects.length === 0) return undefined;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

export const rectIntersection = (a: NormalizedRect, b: NormalizedRect): NormalizedRect | undefined => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

export const rectIou = (a: NormalizedRect, b: NormalizedRect): number => {
  const inter = rectIntersection(a, b);
  if (!inter) return 0;
  const i = rectArea(inter);
  return i / (rectArea(a) + rectArea(b) - i);
};
