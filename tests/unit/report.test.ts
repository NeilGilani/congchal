import type { DepartmentMatch } from '@/models/civic';
import type { ReportCheck } from '@/models/report';
import { emailSubject, renderReportHtml, renderReportText, REPORT_DISCLAIMER } from '@/services/report/reportFormat';
import { checkReport, generateDescription, isReportReady, MIN_REPORT_CONFIDENCE, updateReport } from '@/services/report/reportService';
import { createMemoryStore } from '@/storage/kv';
import { createRepositories, reportsFor, setRepositories } from '@/storage/repositories';

import { makeDetection, makeFix, makeReport, makeScan } from '../fixtures/records';

const ADDRESS = {
  line1: '200 East Santa Clara Street',
  city: 'San Jose',
  state: 'CA',
  formatted: '200 East Santa Clara Street, San Jose, CA 95113',
  source: 'nominatim' as const,
};

const SJ_DOT: DepartmentMatch = {
  name: 'Department of Transportation',
  organization: 'City of San José',
  certainty: 'likely',
  basis: 'San José routes this kind of request to Department of Transportation.',
  reportingUrl: 'https://www.sanjoseca.gov/your-government/departments-offices/information-technology/san-jos-311-8839',
  reportingLabel: 'Open San José 311',
};

const check = (checks: readonly ReportCheck[], id: ReportCheck['id']): ReportCheck => {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`missing check ${id}`);
  return c;
};

describe('generateDescription', () => {
  it('states only what the scan found: surface, address, position, visual evidence, safety note and time', () => {
    const scan = makeScan({ address: ADDRESS });
    expect(generateDescription(scan, 'pothole')).toBe(
      'Pothole observed on the roadway near 200 East Santa Clara Street (in the lower center of the photo). ' +
        'Visible: irregular depression in the pavement; broken, jagged pavement edges. ' +
        'Appears to be within a vehicle travel path. ' +
        'Photographed October 6, 2026 at 5:05 PM.',
    );
  });

  it('leaves out evidence it does not have', () => {
    const scan = makeScan({
      address: undefined,
      analysis: { ...makeScan().analysis, sceneContext: [] },
      detections: [makeDetection({ boundingBox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, evidence: [], severity: undefined })],
    });
    expect(generateDescription(scan, 'pothole')).toBe('Pothole observed (in the center of the photo). Photographed October 6, 2026 at 5:05 PM.');
  });

  it('does not borrow the detection\'s evidence for a category the user picked instead', () => {
    const text = generateDescription(makeScan(), 'pavement_crack');
    expect(text.startsWith('Pavement cracking observed on the roadway')).toBe(true);
    expect(text).not.toContain('Visible:');
    expect(text).not.toContain('vehicle travel path');
  });

  it('omits the safety note for a low-severity detection', () => {
    const base = makeDetection();
    const low = makeDetection({ severity: base.severity && { ...base.severity, level: 'low' } });
    expect(generateDescription(makeScan({ detections: [low] }), 'pothole')).not.toContain('vehicle travel path');
  });
});

describe('checkReport / isReportReady', () => {
  it('passes a complete, reviewed report', () => {
    const checks = checkReport(makeReport());
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(isReportReady(checks)).toBe(true);
  });

  it('blocks a report without a location and says how to fix it', () => {
    const checks = checkReport(makeReport({ location: undefined }));
    const loc = check(checks, 'location');
    expect(loc.passed).toBe(false);
    expect(loc.blocking).toBe(true);
    expect(loc.hint).toMatch(/location|address/i);
    expect(isReportReady(checks)).toBe(false);
  });

  it('accepts a low-accuracy location but asks for a landmark', () => {
    const loc = check(checkReport(makeReport({ location: makeFix({ accuracy: 120 }) })), 'location');
    expect(loc.passed).toBe(true);
    expect(loc.hint).toMatch(/landmark/);
  });

  it('blocks descriptions shorter than 15 characters after trimming', () => {
    const short = checkReport(makeReport({ description: '   Big hole       ' }));
    expect(check(short, 'description').passed).toBe(false);
    expect(isReportReady(short)).toBe(false);
    expect(check(checkReport(makeReport({ description: 'Deep pothole!!!' })), 'description').passed).toBe(true);
  });

  it('blocks a report the user has not reviewed', () => {
    const checks = checkReport(makeReport({ userReviewedDetection: false }));
    expect(check(checks, 'reviewed').passed).toBe(false);
    expect(isReportReady(checks)).toBe(false);
  });

  it('treats low model confidence as an advisory warning only', () => {
    const checks = checkReport(makeReport({ detectionConfidence: 0.41, detectionConfidenceLevel: 'low' }));
    const conf = check(checks, 'confidence');
    expect(conf.passed).toBe(false);
    expect(conf.blocking).toBe(false);
    expect(conf.hint).toMatch(/not confident/);
    expect(isReportReady(checks)).toBe(true);
  });

  it('uses an inclusive confidence threshold and explains user-chosen categories', () => {
    expect(check(checkReport(makeReport({ detectionConfidence: MIN_REPORT_CONFIDENCE })), 'confidence').passed).toBe(true);
    const chosen = check(checkReport(makeReport({ detectionConfidence: undefined })), 'confidence');
    expect(chosen.passed).toBe(false);
    expect(chosen.hint).toMatch(/chose this category yourself/);
  });

  it('blocks a report without a photo', () => {
    expect(isReportReady(checkReport(makeReport({ photoUri: '' })))).toBe(false);
  });
});

describe('updateReport', () => {
  beforeEach(() => setRepositories(createRepositories(createMemoryStore())));

  it('sanitizes an edited description before storing it', async () => {
    const report = makeReport();
    await reportsFor(false).put(report);
    const updated = await updateReport(report, {
      description: '  Deep pothole\r\nby the bus stop\u0000​‮.\n\n\n\n\n\nCars     swerve\taround it.  ',
      descriptionEdited: true,
    });
    expect(updated?.description).toBe('Deep pothole\nby the bus stop.\n\n\nCars  swerve\taround it.');
    expect(updated?.descriptionEdited).toBe(true);
    expect(updated?.updatedAt).not.toBe(report.updatedAt);
    expect((await reportsFor(false).get(report.id))?.description).toBe(updated?.description);
  });

  it('leaves the description alone when the patch does not touch it', async () => {
    const report = makeReport({ description: 'Pothole   with  spaces kept as typed' });
    await reportsFor(false).put(report);
    const updated = await updateReport(report, { userReviewedDetection: true });
    expect(updated?.description).toBe(report.description);
  });

  it('writes demo reports to the demo collection only', async () => {
    const demo = makeReport({ id: 'rep_demo', isDemo: true });
    await reportsFor(true).put(demo);
    await updateReport(demo, { severity: 'low', severityOverridden: true });
    expect((await reportsFor(true).get('rep_demo'))?.severity).toBe('low');
    expect(await reportsFor(false).get('rep_demo')).toBeUndefined();
  });

  it('returns undefined for a report that was never stored', async () => {
    expect(await updateReport(makeReport({ id: 'rep_missing' }), { description: 'x' })).toBeUndefined();
  });
});

describe('renderReportText', () => {
  it('lists the report fields, the description and the disclaimer', () => {
    const text = renderReportText(makeReport({ department: SJ_DOT }), 'imperial');
    const lines = text.split('\n');
    expect(lines[0]).toBe('CIVICLENS REPORT');
    expect(lines).toEqual(
      expect.arrayContaining([
        'Issue: Pothole',
        'Location: 200 East Santa Clara Street, San Jose, CA 95113',
        'Coordinates: 37.33820, -121.88630',
        'GPS accuracy: ±26 ft',
        'Department: Department of Transportation (likely)',
        'Date: October 6, 2026',
        'Time: 5:05 PM',
        'Estimated severity: High',
        'Detection confidence: High confidence (93% model confidence)',
        'Pothole observed on the roadway near 200 East Santa Clara Street.',
        `Official reporting channel: ${SJ_DOT.reportingUrl}`,
        `Important: ${REPORT_DISCLAIMER}`,
      ]),
    );
    expect(text).not.toContain('DEMO MODE');
  });

  it('says when the category or severity came from the reporter, and marks demo data', () => {
    const text = renderReportText(
      makeReport({ detectionConfidence: undefined, severityOverridden: true, isDemo: true, location: undefined, address: undefined }),
      'metric',
    );
    expect(text).toContain('Detection confidence: Not applicable: category chosen by the reporter');
    expect(text).toContain('Severity (set by reporter): High');
    expect(text).toContain('Location: Address not available');
    expect(text).not.toContain('Coordinates:');
    expect(text).toContain('DEMO MODE: sample data, not a real observation.');
  });

  it('uses metric accuracy when asked', () => {
    expect(renderReportText(makeReport(), 'metric')).toContain('GPS accuracy: ±8 m');
  });
});

describe('REPORT_DISCLAIMER', () => {
  it('tells the reader the analysis is automated and must be reviewed before submission', () => {
    expect(REPORT_DISCLAIMER).toMatch(/automated visual analysis/);
    expect(REPORT_DISCLAIMER).toMatch(/reviewed by the user before submission/);
    expect(REPORT_DISCLAIMER).toMatch(/not a legal or engineering determination/);
  });
});

describe('renderReportHtml', () => {
  const hostile = makeReport({
    description: '<script>alert("pwned")</script> Tom & Jerry\'s corner',
    address: { ...ADDRESS, formatted: '<img src=x onerror=alert(1)> Main & 1st' },
    department: { ...SJ_DOT, name: 'Parks, Recreation & Neighborhood Services' },
  });

  it('escapes user text so it cannot inject markup', () => {
    const html = renderReportHtml(hostile, 'imperial', undefined);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt; Tom &amp; Jerry&#39;s corner');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; Main &amp; 1st');
    expect(html).toContain('Parks, Recreation &amp; Neighborhood Services (likely)');
  });

  it('includes the disclaimer and the photo when one is provided', () => {
    const html = renderReportHtml(hostile, 'imperial', 'data:image/jpeg;base64,/9j/4AAQ');
    expect(html).toContain(REPORT_DISCLAIMER);
    expect(html).toContain('<img class="photo" src="data:image/jpeg;base64,/9j/4AAQ"');
    expect(renderReportHtml(hostile, 'imperial', undefined)).toContain('Photo unavailable.');
  });

  it('marks demo reports', () => {
    expect(renderReportHtml(makeReport({ isDemo: true }), 'imperial', undefined)).toContain('DEMO MODE');
    expect(renderReportHtml(makeReport(), 'imperial', undefined)).not.toContain('class="demo"');
  });
});

describe('emailSubject', () => {
  it('names the issue and the street, and flags demo data', () => {
    expect(emailSubject(makeReport())).toBe('Report: Pothole near 200 East Santa Clara Street');
    expect(emailSubject(makeReport({ category: 'graffiti', isDemo: true, address: undefined }))).toBe('[DEMO] Report: Graffiti');
  });
});
