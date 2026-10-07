import type { CategoryScore, Detection, Evidence, ModelInfo } from './detection';
import type { DuplicateCheckResult } from './civic';
import type { IssueCategory } from './issue';
import type { Address, GeoFix, Jurisdiction, RoadContext } from './location';

export type ScanStatus = 'scanned' | 'reviewed' | 'reported' | 'resolved';
export type ScanSource = 'camera' | 'live' | 'gallery' | 'demo';
export type AnalysisOutcome = 'detected' | 'uncertain' | 'none' | 'rejected_quality';

export interface QualitySummary {
  ok: boolean;
  issues: { kind: string; level: 'blocking' | 'warning'; message: string; guidance: string }[];
  sharpness: number;
  meanLuma: number;
}

export interface AnalysisSummary {
  outcome: AnalysisOutcome;
  model: ModelInfo;
  latencyMs: number;
  inferenceMs: number;
  regionsAnalyzed: number;
  imageWidth: number;
  imageHeight: number;
  topScores: CategoryScore[];
  sceneContext: Evidence[];
}

export interface Scan {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: ScanSource;
  /** Local file URI of the evidence photo (app document directory). */
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  location?: GeoFix;
  address?: Address;
  jurisdiction?: Jurisdiction;
  roadContext?: RoadContext;
  quality: QualitySummary;
  analysis: AnalysisSummary;
  detections: Detection[];
  /** Category the user confirmed or chose (may differ from the model). */
  confirmedCategory?: IssueCategory;
  userReviewed: boolean;
  status: ScanStatus;
  duplicateCheck?: DuplicateCheckResult;
  /** Times the user re-observed this issue ("still present"). */
  observations: string[];
  /** Enrichment that still needs network access. */
  pendingLookups: ('address' | 'jurisdiction' | 'civic')[];
  isDemo: boolean;
  /** Which bundled sample photo a Demo Mode scan came from. */
  demoScenarioId?: string;
  /** Free-text note from the user. */
  note?: string;
}

/**
 * When the photo was taken: an uploaded photo's own EXIF time (carried in its
 * location fix), otherwise the moment it was scanned.
 */
export const photographedAt = (scan: Pick<Scan, 'createdAt' | 'location'>): string =>
  scan.location?.source === 'photo-exif' ? scan.location.timestamp : scan.createdAt;
