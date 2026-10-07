import type { ConfidenceLevel, IssueCategory, SeverityLevel } from './issue';

/** Normalised (0..1) rectangle relative to the analysed photo. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type EvidenceKind = 'visual' | 'context' | 'temporal' | 'quality';

/** One observation that supports (or weakens) a detection. Always model- or data-derived. */
export interface Evidence {
  id: string;
  kind: EvidenceKind;
  label: string;
  /** Standardised strength where available (z-score vs. reference street scenes). */
  strength?: number;
  strengthLabel?: 'strong' | 'moderate' | 'weak';
  supports: boolean;
}

export interface ModelInfo {
  modelName: string;
  modelVersion: string;
  headVersion: string;
  backend: 'on-device' | 'browser' | 'remote' | 'node';
}

export interface SeverityFactor {
  id: 'safety' | 'accessibility' | 'size' | 'location' | 'obstruction' | 'confidence';
  label: string;
  /** 0..1 contribution before weighting. */
  value: number;
  note: string;
}

export interface SeverityEstimate {
  level: SeverityLevel;
  /** 0..100 composite score. */
  score: number;
  factors: SeverityFactor[];
  rationale: string;
}

export interface Detection {
  id: string;
  category: IssueCategory;
  /** Calibrated model probability for this category (0..1). */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /**
   * Region of strongest visual evidence, derived from the model's scores on
   * overlapping crops. It is not a pixel-tight object outline.
   */
  boundingBox?: BoundingBox;
  severity?: SeverityEstimate;
  evidence: Evidence[];
  explanation: string;
  model: ModelInfo;
  timestamp: string;
  /** Number of consecutive live frames that agreed (live mode only). */
  framesConfirmed?: number;
}

export interface CategoryScore {
  category: IssueCategory | 'none';
  probability: number;
}
