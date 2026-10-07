import type { Scan } from '@/models/scan';
import { civicStreak, computeImpact, isVerifiedObservation, reportQualityScore } from '@/services/impact/impactService';

import { makeFix, makeReport, makeScan } from '../fixtures/records';

/** Local noon `daysAgo` days before Oct 6, 2026 (streaks are counted in local days). */
const day = (daysAgo: number, hour = 12) => new Date(2026, 9, 6 - daysAgo, hour, 0, 0).toISOString();
const NOW = new Date(2026, 9, 6, 20, 0, 0);

const verified = (id: string, createdAt: string, extra: Partial<Scan> = {}): Scan =>
  makeScan({ id, createdAt, userReviewed: true, status: 'reviewed', ...extra });

const DUP_CHECK = { checkedAt: day(0), radiusMeters: 58, candidates: [], sourcesChecked: ['SeeClickFix'], sourcesFailed: [] };

describe('isVerifiedObservation', () => {
  it('requires a real, reviewed, good-quality scan with a category', () => {
    expect(isVerifiedObservation(verified('a', day(0)))).toBe(true);
    expect(isVerifiedObservation(verified('a', day(0), { isDemo: true }))).toBe(false);
    expect(isVerifiedObservation(verified('a', day(0), { userReviewed: false }))).toBe(false);
    expect(isVerifiedObservation(verified('a', day(0), { quality: { ok: false, issues: [], sharpness: 4, meanLuma: 90 } }))).toBe(false);
    expect(isVerifiedObservation(verified('a', day(0), { detections: [] }))).toBe(false);
    expect(isVerifiedObservation(verified('a', day(0), { detections: [], confirmedCategory: 'graffiti' }))).toBe(true);
  });
});

describe('civicStreak', () => {
  it('counts consecutive days ending today', () => {
    const scans = [verified('a', day(0, 9)), verified('b', day(0, 18)), verified('c', day(1)), verified('d', day(2)), verified('e', day(4))];
    expect(civicStreak(scans, NOW)).toBe(3);
  });

  it('still counts a streak that ended yesterday', () => {
    expect(civicStreak([verified('a', day(1)), verified('b', day(2))], NOW)).toBe(2);
  });

  it('is zero after a missed day', () => {
    expect(civicStreak([verified('a', day(2)), verified('b', day(3))], NOW)).toBe(0);
    expect(civicStreak([], NOW)).toBe(0);
  });

  it('ignores scans that are not verified observations', () => {
    const scans = [verified('a', day(0)), verified('b', day(1), { userReviewed: false }), verified('c', day(2))];
    expect(civicStreak(scans, NOW)).toBe(1);
  });

  it('counts across a month boundary', () => {
    const now = new Date(2026, 9, 1, 8, 0, 0);
    const scans = [new Date(2026, 9, 1, 7), new Date(2026, 8, 30, 12), new Date(2026, 8, 29, 23)].map((d, i) => verified(`s${i}`, d.toISOString()));
    expect(civicStreak(scans, now)).toBe(3);
  });
});

describe('reportQualityScore', () => {
  it('scores a complete, reviewed report 100', () => {
    const scan = makeScan({ duplicateCheck: DUP_CHECK });
    const report = makeReport({ detectionConfidence: 0.95, description: 'Deep pothole in the eastbound lane, about 60 cm across.' });
    expect(reportQualityScore(report, scan)).toBe(100);
  });

  it('matches a hand computation for a weak report', () => {
    // quality warning 0.6, confidence 0.45/0.9 = 0.5, unreviewed 0, no duplicate check 0.5, poor GPS 0.5, short text 0.5
    const scan = makeScan({
      quality: { ok: true, issues: [{ kind: 'blurry', level: 'warning', message: 'Slightly blurry', guidance: 'Hold steady' }], sharpness: 40, meanLuma: 110 },
    });
    const report = makeReport({
      detectionConfidence: 0.45,
      userReviewedDetection: false,
      location: makeFix({ accuracy: 140 }),
      description: 'Pothole near the bus stop',
    });
    expect(reportQualityScore(report, scan)).toBe(Math.round((2.6 / 6) * 100));
  });

  it('handles a missing scan and a user-chosen category', () => {
    // no scan 0, chosen category 0.5, reviewed 1, no duplicate check 0.5, no location 0, long text 1
    const report = makeReport({ detectionConfidence: undefined, location: undefined, description: 'Mattress and two sofas dumped on the sidewalk.' });
    expect(reportQualityScore(report, undefined)).toBe(50);
  });
});

describe('computeImpact', () => {
  const scans: Scan[] = [
    verified('s1', day(0), { duplicateCheck: DUP_CHECK }),
    makeScan({ id: 's2', createdAt: day(0) }),
    makeScan({ id: 's3', createdAt: day(1), detections: [], analysis: { ...makeScan().analysis, outcome: 'none' } }),
    verified('s4', day(1), { isDemo: true }),
    verified('s5', day(1), { quality: { ok: false, issues: [], sharpness: 5, meanLuma: 100 } }),
    makeScan({ id: 's6', createdAt: day(2), duplicateCheck: { ...DUP_CHECK, decision: 'still_present' } }),
    makeScan({ id: 's7', createdAt: day(2), duplicateCheck: { ...DUP_CHECK, decision: 'report_anyway' }, status: 'reported' }),
    verified('s8', day(3), { status: 'resolved' }),
    makeScan({ id: 's9', createdAt: day(3), detections: [], confirmedCategory: 'fallen_tree', analysis: { ...makeScan().analysis, outcome: 'none' } }),
  ];
  const sharedByEmail = makeReport({
    id: 'r1',
    scanId: 's1',
    exports: [{ channel: 'email', at: day(0) }],
    description: 'Deep pothole in the eastbound lane, about 60 cm across.',
  });
  const sharedAsPdf = makeReport({ id: 'r2', scanId: 's7', exports: [{ channel: 'pdf', at: day(2) }], userReviewedDetection: false });
  const draft = makeReport({ id: 'r3', scanId: 's2' });
  const demoShared = makeReport({ id: 'r4', scanId: 's4', isDemo: true, exports: [{ channel: 'share', at: day(1) }] });
  const reports = [sharedByEmail, sharedAsPdf, draft, demoShared];
  const scanById = (id: string) => scans.find((s) => s.id === id);

  it('counts only the user\'s own non-demo data', () => {
    const stats = computeImpact(scans, reports, NOW);
    expect(stats.issuesIdentified).toBe(7); // s1 s2 s5 s6 s7 s8 (detected) + s9 (confirmed); not s3, not demo s4
    expect(stats.reportsCreated).toBe(3);
    expect(stats.reportsShared).toBe(2);
    expect(stats.duplicatesAvoided).toBe(1); // s6 only: s7 was reported anyway
    expect(stats.resolved).toBe(1);
    expect(stats.verifiedObservations).toBe(2); // s1, s8 (s4 is demo, s5 failed quality, others unreviewed)
    expect(stats.streakDays).toBe(1); // s1 today; s8 was three days ago
  });

  it('averages report quality over shared reports only', () => {
    const stats = computeImpact(scans, reports, NOW);
    const expected = Math.round((reportQualityScore(sharedByEmail, scanById('s1')) + reportQualityScore(sharedAsPdf, scanById('s7'))) / 2);
    expect(stats.reportQuality).toBe(expected);
    expect(stats.reportQuality).toBeLessThan(100);
    expect(computeImpact(scans, [draft, demoShared], NOW).reportQuality).toBeUndefined();
  });

  it('is all zeros for a new user', () => {
    expect(computeImpact([], [], NOW)).toEqual({
      issuesIdentified: 0,
      reportsCreated: 0,
      reportsShared: 0,
      duplicatesAvoided: 0,
      resolved: 0,
      verifiedObservations: 0,
      streakDays: 0,
      reportQuality: undefined,
    });
  });
});
