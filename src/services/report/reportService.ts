import { CATEGORY_INFO } from '@/constants/categories';
import type { DepartmentMatch } from '@/models/civic';
import type { IssueCategory } from '@/models/issue';
import type { ExportChannel, Report, ReportCheck } from '@/models/report';
import type { Scan } from '@/models/scan';
import { matchDepartment } from '@/services/civic/departmentService';
import { classifyAccuracy } from '@/services/location/locationQuality';
import { reportsFor, scansFor } from '@/storage/repositories';
import { formatDateLong, formatTime } from '@/utils/format';
import { newId } from '@/utils/ids';
import { sanitizeUserText } from '@/utils/sanitize';

/** Minimum model confidence for a report to pass the "confidence" check without user override. */
export const MIN_REPORT_CONFIDENCE = 0.55;

const positionPhrase = (scan: Scan): string | undefined => {
  const box = scan.detections[0]?.boundingBox;
  if (!box) return undefined;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const h = cx < 0.38 ? 'left' : cx > 0.62 ? 'right' : 'center';
  const v = cy < 0.38 ? 'upper' : cy > 0.62 ? 'lower' : 'middle';
  return h === 'center' && v === 'middle' ? 'in the center of the photo' : `in the ${v} ${h} of the photo`;
};

/**
 * Draft description built only from facts CivicLens has: the category, the
 * visual evidence it actually found, the scene context, the severity
 * estimate and the address. The user is expected to edit it.
 */
export const generateDescription = (scan: Scan, category: IssueCategory): string => {
  const info = CATEGORY_INFO[category];
  const det = scan.detections.find((d) => d.category === category);
  const parts: string[] = [];
  const surface = scan.analysis.sceneContext.find((e) => e.id === 'ctx:roadway')
    ? 'on the roadway'
    : scan.analysis.sceneContext.find((e) => e.id === 'ctx:sidewalk')
      ? 'on the sidewalk'
      : undefined;
  const where = scan.address?.line1 ?? scan.address?.formatted;
  let first = `${info.label} observed${surface ? ` ${surface}` : ''}${where ? ` near ${where}` : ''}`;
  const pos = positionPhrase(scan);
  if (pos) first += ` (${pos})`;
  parts.push(`${first}.`);
  const visual = det?.evidence.filter((e) => e.kind === 'visual' && e.supports).map((e) => e.label.toLowerCase()) ?? [];
  if (visual.length) parts.push(`Visible: ${visual.join('; ')}.`);
  if (det?.severity && det.severity.level !== 'low') {
    const note = det.severity.factors.find((f) => f.id === 'safety' && f.value > 0.6)?.note;
    if (note) parts.push(note);
  }
  parts.push(`Photographed ${formatDateLong(scan.createdAt)} at ${formatTime(scan.createdAt)}.`);
  return parts.join(' ');
};

export const departmentFor = (scan: Scan, category: IssueCategory): DepartmentMatch =>
  matchDepartment(category, scan.jurisdiction, scan.roadContext);

export const createDraftReport = async (scan: Scan, category: IssueCategory): Promise<Report> => {
  const existing = (await reportsFor(scan.isDemo).list()).find((r) => r.scanId === scan.id);
  if (existing) return existing;
  const det = scan.detections.find((d) => d.category === category);
  const now = new Date().toISOString();
  const report: Report = {
    id: newId('rep'),
    scanId: scan.id,
    createdAt: now,
    updatedAt: now,
    category,
    description: generateDescription(scan, category),
    descriptionEdited: false,
    severity: det?.severity?.level,
    severityOverridden: false,
    detectionConfidence: det?.confidence,
    detectionConfidenceLevel: det?.confidenceLevel,
    location: scan.location,
    address: scan.address,
    jurisdiction: scan.jurisdiction,
    department: departmentFor(scan, category),
    photoUri: scan.imageUri,
    userReviewedDetection: scan.userReviewed,
    status: 'draft',
    exports: [],
    isDemo: scan.isDemo,
  };
  await reportsFor(scan.isDemo).put(report);
  return report;
};

export const updateReport = (report: Report, patch: Partial<Report>): Promise<Report | undefined> =>
  reportsFor(report.isDemo).update(report.id, (r) => {
    const next = { ...r, ...patch, updatedAt: new Date().toISOString() };
    if (patch.description !== undefined) next.description = sanitizeUserText(patch.description);
    return next;
  });

/** Report quality checklist (blocking items prevent export). */
export const checkReport = (report: Report): ReportCheck[] => {
  const acc = classifyAccuracy(report.location?.accuracy);
  const conf = report.detectionConfidence;
  return [
    { id: 'image', label: 'Photo attached', passed: Boolean(report.photoUri), blocking: true },
    { id: 'category', label: 'Issue type selected', passed: Boolean(report.category), blocking: true },
    {
      id: 'location',
      label: 'Location available',
      passed: Boolean(report.location),
      blocking: true,
      hint: !report.location
        ? 'Turn on location or add the address in the description.'
        : acc === 'poor'
          ? 'Location accuracy is low. Mention a nearby landmark in the description.'
          : undefined,
    },
    {
      id: 'confidence',
      label: 'Detection confidence sufficient',
      passed: conf !== undefined && conf >= MIN_REPORT_CONFIDENCE,
      blocking: false,
      hint:
        conf === undefined
          ? 'You chose this category yourself. Make sure the photo shows it clearly.'
          : conf < MIN_REPORT_CONFIDENCE
            ? 'CivicLens was not confident. Double-check the photo before sharing.'
            : undefined,
    },
    {
      id: 'description',
      label: 'Description present',
      passed: report.description.trim().length >= 15,
      blocking: true,
      hint: report.description.trim().length < 15 ? 'Add a short description (at least 15 characters).' : undefined,
    },
    {
      id: 'reviewed',
      label: 'You reviewed the photo and detection',
      passed: report.userReviewedDetection,
      blocking: true,
    },
  ];
};

export const isReportReady = (checks: readonly ReportCheck[]): boolean => checks.every((c) => c.passed || !c.blocking);

export const recordExport = async (report: Report, channel: ExportChannel): Promise<void> => {
  await updateReport(report, { status: 'exported', exports: [...report.exports, { channel, at: new Date().toISOString() }] });
  await scansFor(report.isDemo).update(report.scanId, (s) => ({ ...s, status: s.status === 'resolved' ? s.status : 'reported' }));
};
