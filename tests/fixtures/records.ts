import type { Detection, ModelInfo } from '@/models/detection';
import type { GeoFix } from '@/models/location';
import type { Report } from '@/models/report';
import type { Scan } from '@/models/scan';

/** Builders for stored records. Values mirror what the app writes for a real pothole scan in San José. */
export const MODEL_INFO: ModelInfo = {
  modelName: 'SigLIP 2 B/32 (256 px) + CivicLens head',
  modelVersion: 'siglip2-b32-256-q8',
  headVersion: '1.0.0',
  backend: 'node',
};

/** 5:05 PM local time on Oct 6, 2026, so date/time formatting is timezone independent. */
export const LOCAL_EVENING = new Date(2026, 9, 6, 17, 5, 0).toISOString();

export const makeFix = (overrides: Partial<GeoFix> = {}): GeoFix => ({
  latitude: 37.3382,
  longitude: -121.8863,
  accuracy: 8,
  timestamp: LOCAL_EVENING,
  source: 'gps',
  ...overrides,
});

export const makeDetection = (overrides: Partial<Detection> = {}): Detection => ({
  id: 'det_fixture',
  category: 'pothole',
  confidence: 0.93,
  confidenceLevel: 'high',
  boundingBox: { x: 0.3, y: 0.55, width: 0.4, height: 0.35 },
  severity: {
    level: 'high',
    score: 68,
    factors: [
      { id: 'safety', label: 'Safety', value: 0.78, note: 'Appears to be within a vehicle travel path.' },
      { id: 'size', label: 'Size', value: 0.7, note: 'The defect looks large in the photo.' },
    ],
    rationale: 'Pothole with safety concerns. Appears to be within a vehicle travel path.',
  },
  evidence: [
    { id: 'ev:pothole:hole', kind: 'visual', label: 'Irregular depression in the pavement', strength: 4.9, strengthLabel: 'strong', supports: true },
    { id: 'ev:pothole:edges', kind: 'visual', label: 'Broken, jagged pavement edges', strength: 4.2, strengthLabel: 'strong', supports: true },
    { id: 'ctx:roadway', kind: 'context', label: 'Roadway surface visible', strength: 2.1, strengthLabel: 'strong', supports: true },
    { id: 'region-only', kind: 'visual', label: 'Seen in one part of the frame only', supports: false },
  ],
  explanation: 'Strong visual evidence of a pothole: irregular depression in the pavement, broken, jagged pavement edges.',
  model: MODEL_INFO,
  timestamp: LOCAL_EVENING,
  ...overrides,
});

export const makeScan = (overrides: Partial<Scan> = {}): Scan => ({
  id: 'scan_fixture',
  createdAt: LOCAL_EVENING,
  updatedAt: LOCAL_EVENING,
  source: 'camera',
  imageUri: 'file:///data/user/0/app/files/scans/scan_fixture.jpg',
  imageWidth: 1280,
  imageHeight: 960,
  location: makeFix(),
  quality: { ok: true, issues: [], sharpness: 210, meanLuma: 118 },
  analysis: {
    outcome: 'detected',
    model: MODEL_INFO,
    latencyMs: 730,
    inferenceMs: 610,
    regionsAnalyzed: 11,
    imageWidth: 512,
    imageHeight: 384,
    topScores: [
      { category: 'pothole', probability: 0.93 },
      { category: 'pavement_crack', probability: 0.05 },
    ],
    sceneContext: [{ id: 'ctx:roadway', kind: 'context', label: 'Roadway surface visible', strength: 2.1, supports: true }],
  },
  detections: [makeDetection()],
  userReviewed: false,
  status: 'scanned',
  observations: [],
  pendingLookups: [],
  isDemo: false,
  ...overrides,
});

export const makeReport = (overrides: Partial<Report> = {}): Report => ({
  id: 'rep_fixture',
  scanId: 'scan_fixture',
  createdAt: LOCAL_EVENING,
  updatedAt: LOCAL_EVENING,
  category: 'pothole',
  description: 'Pothole observed on the roadway near 200 East Santa Clara Street.',
  descriptionEdited: false,
  severity: 'high',
  severityOverridden: false,
  detectionConfidence: 0.93,
  detectionConfidenceLevel: 'high',
  location: makeFix(),
  address: {
    line1: '200 East Santa Clara Street',
    street: 'East Santa Clara Street',
    city: 'San Jose',
    state: 'CA',
    postalCode: '95113',
    country: 'US',
    formatted: '200 East Santa Clara Street, San Jose, CA 95113',
    source: 'nominatim',
  },
  photoUri: 'file:///data/user/0/app/files/scans/scan_fixture.jpg',
  userReviewedDetection: true,
  status: 'draft',
  exports: [],
  isDemo: false,
  ...overrides,
});
