import type { DepartmentMatch } from './civic';
import type { SeverityLevel, ConfidenceLevel, IssueCategory } from './issue';
import type { Address, GeoFix, Jurisdiction } from './location';

export type ReportStatus = 'draft' | 'ready' | 'exported';

export type ExportChannel = 'pdf' | 'share' | 'copy' | 'email' | 'official_link';

export interface ExportEvent {
  channel: ExportChannel;
  at: string;
}

export interface Report {
  id: string;
  scanId: string;
  createdAt: string;
  updatedAt: string;
  category: IssueCategory;
  description: string;
  /** True once the user edited the generated description. */
  descriptionEdited: boolean;
  severity?: SeverityLevel;
  /** The user may override the automated severity estimate. */
  severityOverridden: boolean;
  /** Model confidence for `category` at scan time (absent if the user picked a category the model did not suggest). */
  detectionConfidence?: number;
  detectionConfidenceLevel?: ConfidenceLevel;
  location?: GeoFix;
  address?: Address;
  jurisdiction?: Jurisdiction;
  department?: DepartmentMatch;
  photoUri: string;
  /** User explicitly confirmed they reviewed the photo and detection. */
  userReviewedDetection: boolean;
  status: ReportStatus;
  exports: ExportEvent[];
  isDemo: boolean;
}

export interface ReportCheck {
  id: 'image' | 'category' | 'location' | 'confidence' | 'description' | 'reviewed';
  label: string;
  passed: boolean;
  /** Blocking checks prevent export; advisory checks only warn. */
  blocking: boolean;
  hint?: string;
}
