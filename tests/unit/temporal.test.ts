import { LiveFrameFusion } from '@/ml/temporal';

const frame = (at: number, pothole: number, opts: { blocked?: boolean; region?: { x: number; y: number; width: number; height: number }; graffiti?: number } = {}) => ({
  at,
  qualityBlocked: opts.blocked ?? false,
  region: opts.region,
  probabilities: { none: 1 - pothole - (opts.graffiti ?? 0), pothole, graffiti: opts.graffiti ?? 0 },
});

describe('LiveFrameFusion', () => {
  it('confirms only after three consistent frames and reports the mean (not an inflated) confidence', () => {
    const f = new LiveFrameFusion();
    expect(f.push(frame(0, 0.61)).status).toBe('candidate');
    expect(f.push(frame(400, 0.73)).status).toBe('candidate');
    const s = f.push(frame(800, 0.81));
    expect(s.status).toBe('confirmed');
    expect(s.category).toBe('pothole');
    expect(s.streak).toBe(3);
    expect(s.confidence).toBeCloseTo((0.61 + 0.73 + 0.81) / 3, 5);
  });

  it('never confirms from a single strong frame', () => {
    const f = new LiveFrameFusion();
    const s = f.push(frame(0, 0.97));
    expect(s.status).toBe('candidate');
  });

  it('does not confirm when frames agree but the mean probability is weak', () => {
    const f = new LiveFrameFusion();
    f.push(frame(0, 0.36));
    f.push(frame(400, 0.4));
    expect(f.push(frame(800, 0.38)).status).toBe('candidate');
  });

  it('restarts the streak when the top category changes', () => {
    const f = new LiveFrameFusion();
    f.push(frame(0, 0.7));
    f.push(frame(400, 0.7));
    const s = f.push(frame(800, 0.05, { graffiti: 0.8 }));
    expect(s.category).toBe('graffiti');
    expect(s.streak).toBe(1);
    expect(s.status).toBe('candidate');
  });

  it('restarts when the evidence moves to a different part of the frame', () => {
    const f = new LiveFrameFusion();
    const left = { x: 0, y: 0.5, width: 0.3, height: 0.3 };
    const right = { x: 0.7, y: 0.1, width: 0.3, height: 0.3 };
    f.push(frame(0, 0.7, { region: left }));
    f.push(frame(400, 0.7, { region: left }));
    expect(f.push(frame(800, 0.7, { region: right })).streak).toBe(1);
  });

  it('tolerates one miss but falls back to searching after repeated misses', () => {
    const f = new LiveFrameFusion();
    f.push(frame(0, 0.7));
    expect(f.push(frame(400, 0.1)).status).toBe('candidate');
    expect(f.push(frame(800, 0.1)).status).toBe('searching');
  });

  it('reports poor quality when frames keep failing the quality gate', () => {
    const f = new LiveFrameFusion();
    f.push(frame(0, 0.7, { blocked: true }));
    expect(f.push(frame(400, 0.7, { blocked: true })).status).toBe('poor_quality');
  });

  it('forgets stale history after a long gap', () => {
    const f = new LiveFrameFusion();
    f.push(frame(0, 0.7));
    f.push(frame(400, 0.7));
    expect(f.push(frame(10_000, 0.7)).streak).toBe(1);
  });
});
