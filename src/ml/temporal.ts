import type { NormalizedRect } from './image/types';
import { rectIou } from './regions';

export interface FrameObservation {
  at: number;
  /** Calibrated probabilities per class for this frame (from the head). */
  probabilities: Readonly<Record<string, number>>;
  /** Frame failed the quality gate (blurry, dark, ...). */
  qualityBlocked: boolean;
  /** Where the evidence was strongest in this frame, if known. */
  region?: NormalizedRect;
}

export interface LiveState {
  status: 'idle' | 'searching' | 'candidate' | 'confirmed' | 'poor_quality';
  category?: string;
  /** Mean calibrated probability over the agreeing frames (not inflated). */
  confidence?: number;
  /** Consecutive agreeing frames. */
  streak: number;
  region?: NormalizedRect;
  /** Probabilities of the agreeing frames, oldest first (for the debug panel). */
  history: number[];
}

export interface TemporalConfig {
  /** Minimum per-frame probability for a frame to count as agreeing. */
  candidateThreshold: number;
  /** Frames that must agree before a detection is "confirmed". */
  confirmFrames: number;
  /** Mean probability required (with confirmFrames) to confirm. */
  confirmThreshold: number;
  /** Frames older than this are forgotten. */
  maxGapMs: number;
  /** Regions must overlap at least this much to be "the same place". */
  minRegionIou: number;
  /** How many consecutive misses end a streak. */
  missTolerance: number;
}

export const DEFAULT_TEMPORAL_CONFIG: TemporalConfig = {
  candidateThreshold: 0.35,
  confirmFrames: 3,
  confirmThreshold: 0.5,
  maxGapMs: 2500,
  minRegionIou: 0.2,
  missTolerance: 1,
};

const topIssue = (p: Readonly<Record<string, number>>): [string, number] | undefined => {
  let best: [string, number] | undefined;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'none') continue;
    if (!best || v > best[1]) best = [k, v];
  }
  return best;
};

/**
 * Multi-frame confirmation for the live camera loop.
 *
 * A single frame can only produce a "candidate". A detection is "confirmed"
 * only when the same category is the top issue in `confirmFrames`
 * consecutive frames (tolerating one miss), in roughly the same image region,
 * with a mean probability above `confirmThreshold`. Reported confidence is
 * the mean of the agreeing frames — consistency raises *certainty about the
 * label*, but we never synthesise a probability the model did not produce.
 */
export class LiveFrameFusion {
  private state: LiveState = { status: 'idle', streak: 0, history: [] };
  private lastAt = 0;
  private misses = 0;

  constructor(private readonly config: TemporalConfig = DEFAULT_TEMPORAL_CONFIG) {}

  current(): LiveState {
    return this.state;
  }

  reset(): void {
    this.state = { status: 'idle', streak: 0, history: [] };
    this.misses = 0;
    this.lastAt = 0;
  }

  push(frame: FrameObservation): LiveState {
    const c = this.config;
    if (this.lastAt && frame.at - this.lastAt > c.maxGapMs) this.reset();
    this.lastAt = frame.at;

    if (frame.qualityBlocked) {
      this.misses++;
      if (this.misses > c.missTolerance) {
        this.state = { status: 'poor_quality', streak: 0, history: [] };
      } else {
        this.state = { ...this.state, status: this.state.streak > 0 ? this.state.status : 'poor_quality' };
      }
      return this.state;
    }

    const top = topIssue(frame.probabilities);
    const agrees =
      top !== undefined &&
      top[1] >= c.candidateThreshold &&
      (this.state.category === undefined || this.state.category === top[0]) &&
      (!this.state.region || !frame.region || rectIou(this.state.region, frame.region) >= c.minRegionIou);

    if (top && top[1] >= c.candidateThreshold && !agrees) {
      // A different issue (or place) took over: start a new streak from this frame.
      this.misses = 0;
      this.state = { status: 'candidate', category: top[0], confidence: top[1], streak: 1, region: frame.region, history: [top[1]] };
      return this.state;
    }

    if (!agrees || !top) {
      this.misses++;
      if (this.misses > c.missTolerance) {
        this.state = { status: 'searching', streak: 0, history: [] };
      }
      return this.state;
    }

    this.misses = 0;
    const history = [...this.state.history, top[1]].slice(-6);
    const streak = this.state.streak + 1;
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const confirmed = streak >= c.confirmFrames && mean >= c.confirmThreshold;
    this.state = {
      status: confirmed ? 'confirmed' : 'candidate',
      category: top[0],
      confidence: mean,
      streak,
      region: frame.region ?? this.state.region,
      history,
    };
    return this.state;
  }
}
