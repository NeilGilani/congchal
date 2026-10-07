import {
  ACCURACY_FAIR_M,
  ACCURACY_GOOD_M,
  betterFix,
  classifyAccuracy,
  isFixFresh,
  locationQualityMessage,
  MAX_FIX_AGE_MS,
} from '@/services/location/locationQuality';

import { makeFix } from '../fixtures/records';

const T0 = Date.parse('2026-10-06T17:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();

describe('classifyAccuracy', () => {
  it.each([
    [3, 'good'],
    [ACCURACY_GOOD_M, 'good'],
    [15.1, 'fair'],
    [ACCURACY_FAIR_M, 'fair'],
    [51, 'poor'],
    [1500, 'poor'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [0, 'unknown'],
    [-5, 'unknown'],
    [Number.NaN, 'unknown'],
    [Number.POSITIVE_INFINITY, 'unknown'],
  ])('%p m -> %s', (accuracy, expected) => {
    expect(classifyAccuracy(accuracy)).toBe(expected);
  });
});

describe('locationQualityMessage', () => {
  it('stays quiet for good fixes and explains the others', () => {
    expect(locationQualityMessage('good')).toBeUndefined();
    expect(locationQualityMessage('fair')).toMatch(/approximate/);
    expect(locationQualityMessage('poor')).toMatch(/low/);
    expect(locationQualityMessage('unknown')).toMatch(/didn't report/);
  });
});

describe('isFixFresh', () => {
  it('accepts fixes up to two minutes old', () => {
    const fix = makeFix({ timestamp: at(0) });
    expect(isFixFresh(fix, T0 + MAX_FIX_AGE_MS)).toBe(true);
    expect(isFixFresh(fix, T0 + MAX_FIX_AGE_MS + 1)).toBe(false);
  });
});

describe('betterFix', () => {
  it('takes the new fix when there is no previous one', () => {
    const b = makeFix({ timestamp: at(0) });
    expect(betterFix(undefined, b)).toBe(b);
  });

  it('keeps a much more accurate recent fix over a slightly newer, worse one', () => {
    const a = makeFix({ accuracy: 10, timestamp: at(0) });
    const b = makeFix({ accuracy: 20, timestamp: at(5_000) });
    expect(betterFix(a, b)).toBe(a);
  });

  it('takes a newer fix that is no more than 1.5x less accurate', () => {
    const a = makeFix({ accuracy: 10, timestamp: at(0) });
    expect(betterFix(a, makeFix({ accuracy: 15, timestamp: at(5_000) })).accuracy).toBe(15);
  });

  it('always takes a fix that is more than 30 s newer', () => {
    const a = makeFix({ accuracy: 5, timestamp: at(0) });
    const b = makeFix({ accuracy: 80, timestamp: at(31_000) });
    expect(betterFix(a, b)).toBe(b);
  });

  it('treats an unknown accuracy as the worst', () => {
    const known = makeFix({ accuracy: 30, timestamp: at(0) });
    const unknown = makeFix({ accuracy: null, timestamp: at(1_000) });
    expect(betterFix(known, unknown)).toBe(known);
    expect(betterFix(makeFix({ accuracy: null, timestamp: at(0) }), known).accuracy).toBe(30);
  });
});
