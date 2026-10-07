// Must be first: makes onnxruntime-node's tensors pass instanceof checks inside Jest.
import '../support/mainRealmTypedArrays';

import { analyzeImage, type ImageAnalysis } from '@/ml/pipeline';
import type { EmbeddingBackend } from '@/ml/runtime/types';
import type { Scan } from '@/models/scan';
import { censusResponseSchema, parseCensusJurisdiction } from '@/services/jurisdiction/census';
import { renderReportText, REPORT_DISCLAIMER } from '@/services/report/reportFormat';
import { checkReport, createDraftReport, isReportReady, updateReport } from '@/services/report/reportService';
import { buildScan } from '@/services/scan/scanService';
import { createMemoryStore } from '@/storage/kv';
import { createRepositories, reportsFor, setRepositories } from '@/storage/repositories';

import { censusSanJose } from '../fixtures/census';
import { makeFix } from '../fixtures/records';
import { createBackend, loadDemoImage, loadHead, MODEL_AVAILABLE, MODEL_MISSING_MESSAGE, modelInfoFor } from '../support/model';

// scanService pulls in the on-device runtime, which `require`s the 114 MB model
// as a bundler asset. Metro resolves that to an asset id; Jest would try to
// parse the binary. Only that asset reference is replaced.
jest.mock('../../assets/models/civiclens_vision.onnx', () => 1);

const MODEL_TIMEOUT_MS = 120_000;
const SCANNED_AT = new Date(2026, 9, 6, 17, 5, 0);

if (!MODEL_AVAILABLE) console.warn(MODEL_MISSING_MESSAGE);
const describeWithModel = MODEL_AVAILABLE ? describe : describe.skip;

describeWithModel('pothole photo -> scan -> draft report (real model)', () => {
  const head = loadHead();
  let backend: EmbeddingBackend | undefined;
  let analysis: ImageAnalysis;
  let scan: Scan;

  beforeAll(async () => {
    backend = await createBackend();
    const image = loadDemoImage('pothole.jpg');
    analysis = await analyzeImage(image, { backend, head, mode: 'scan' });
    const built = buildScan({
      id: 'scan_pothole_fixture',
      source: 'camera',
      imageUri: 'file:///data/user/0/app/files/scans/scan_pothole_fixture.jpg',
      width: image.width,
      height: image.height,
      analysis,
      model: modelInfoFor(head),
      location: makeFix({ timestamp: SCANNED_AT.toISOString() }),
      isDemo: false,
      now: SCANNED_AT,
    });
    // What enrichment adds once online: the address and the Census jurisdiction.
    scan = {
      ...built,
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
      jurisdiction: parseCensusJurisdiction(censusResponseSchema.parse(censusSanJose), SCANNED_AT),
    };
  }, MODEL_TIMEOUT_MS);

  afterAll(async () => {
    await backend?.dispose();
  });

  beforeEach(() => {
    setRepositories(createRepositories(createMemoryStore()));
  });

  it('builds a scan record from the analysis', () => {
    expect(scan.analysis.outcome).toBe('detected');
    expect(scan.analysis.topScores[0]?.category).toBe('pothole');
    expect(scan.analysis.regionsAnalyzed).toBe(11);
    expect(scan.analysis.model.backend).toBe('node');
    expect(scan.detections).toHaveLength(1);
    expect(scan.detections[0]?.category).toBe('pothole');
    expect(scan.detections[0]?.severity).toBeDefined();
    expect(scan.createdAt).toBe(SCANNED_AT.toISOString());
    expect(scan.quality.ok).toBe(true);
    expect(scan.userReviewed).toBe(false);
    expect(scan.status).toBe('scanned');
    expect(scan.pendingLookups).toEqual(['address', 'jurisdiction', 'civic']);
  });

  it('creates a draft that needs review, then becomes ready once reviewed and described', async () => {
    const draft = await createDraftReport(scan, 'pothole');
    expect(draft.category).toBe('pothole');
    expect(draft.status).toBe('draft');
    expect(draft.scanId).toBe(scan.id);
    expect(draft.detectionConfidence).toBe(scan.detections[0]?.confidence);
    expect(draft.severity).toBe(scan.detections[0]?.severity?.level);
    expect(draft.description).toMatch(/^Pothole observed/);
    expect(draft.description).toContain('near 200 East Santa Clara Street');
    expect(draft.description).toContain('Photographed October 6, 2026 at 5:05 PM.');
    expect(draft.department).toMatchObject({ name: 'Department of Transportation', organization: 'City of San José', certainty: 'likely' });

    const draftChecks = checkReport(draft);
    expect(draftChecks.find((c) => c.id === 'reviewed')).toMatchObject({ passed: false, blocking: true });
    expect(draftChecks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['reviewed']);
    expect(isReportReady(draftChecks)).toBe(false);

    // Creating the draft again returns the same stored report.
    expect((await createDraftReport(scan, 'pothole')).id).toBe(draft.id);

    const ready = await updateReport(draft, {
      userReviewedDetection: true,
      description: 'Deep pothole in the eastbound lane in front of City Hall.​ Cars swerve around it.',
      descriptionEdited: true,
    });
    if (!ready) throw new Error('report was not stored');
    expect(ready.description).toBe('Deep pothole in the eastbound lane in front of City Hall. Cars swerve around it.');
    expect(isReportReady(checkReport(ready))).toBe(true);
    expect(await reportsFor(false).get(draft.id)).toEqual(ready);

    const text = renderReportText(ready, 'imperial');
    expect(text).toContain(`Important: ${REPORT_DISCLAIMER}`);
    expect(text).toContain('Issue: Pothole');
    expect(text).toContain('Jurisdiction: San Jose, CA');
    expect(text).toContain('Department: Department of Transportation (likely)');
    expect(text).toContain('Deep pothole in the eastbound lane');
    expect(text).not.toContain('DEMO MODE');
  });

  it('keeps a user-chosen category honest: no model confidence is claimed', async () => {
    const draft = await createDraftReport(scan, 'pavement_crack');
    expect(draft.detectionConfidence).toBeUndefined();
    expect(checkReport(draft).find((c) => c.id === 'confidence')).toMatchObject({ passed: false, blocking: false });
    expect(renderReportText(draft, 'imperial')).toContain('Detection confidence: Not applicable: category chosen by the reporter');
  });
});
