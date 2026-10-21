import type { BowlingStyle } from '../model/player.ts';

/**
 * Delivery types. Each is a recipe of physical parameters — speed relative
 * to the bowler's stock ball, swing, seam, spin and constraints on length —
 * rather than a label on an identical projectile.
 */
export type DeliveryTypeId =
  | 'fast'
  | 'slower'
  | 'inswinger'
  | 'outswinger'
  | 'yorker'
  | 'fullToss'
  | 'bouncer'
  | 'offBreak'
  | 'legBreak'
  | 'topSpinner'
  | 'doosra'
  | 'googly';

export interface LengthRange {
  /** Metres in front of the striker's stumps where the ball pitches. */
  readonly min: number;
  readonly max: number;
}

export interface DeliveryTypeDef {
  readonly id: DeliveryTypeId;
  readonly name: string;
  readonly styles: readonly BowlingStyle[];
  /** Multiplier on the bowler's stock speed. */
  readonly speedFactor: number;
  /** Lengths this delivery is bowled at; the plan's length is clamped into it. */
  readonly lengths?: LengthRange;
  /** Never pitches: arrives at the batter on the full. */
  readonly fullToss?: boolean;
  /** Swing relative to the batter: +1 away (outswing), −1 in, 0 none / natural. */
  readonly swing: number;
  /** Seam movement multiplier (random direction, the bowler cannot choose it). */
  readonly seam: number;
  /** Side spin relative to the bowler's stock turn: +1 stock, −1 the other way (wrong'un). */
  readonly turn: number;
  /** Fraction of revolutions as side spin vs. top spin, 0–1. */
  readonly sideSpinShare: number;
  /** Backspin for cutters / slower balls, as a fraction of the bowler's spin rate. */
  readonly backspin?: number;
  /** Execution difficulty: multiplies line/length error. */
  readonly difficulty: number;
  /** Physical effort: multiplies fatigue gained. */
  readonly effort: number;
}

const PACE: readonly BowlingStyle[] = ['fast', 'fastMedium', 'medium'];
const FINGER: readonly BowlingStyle[] = ['offSpin'];
const WRIST: readonly BowlingStyle[] = ['legSpin'];
const ANY_SPIN: readonly BowlingStyle[] = ['offSpin', 'legSpin'];

export const DELIVERY_TYPES: Readonly<Record<DeliveryTypeId, DeliveryTypeDef>> = {
  fast: { id: 'fast', name: 'Stock ball', styles: PACE, speedFactor: 1, swing: 0, seam: 1, turn: 0, sideSpinShare: 0, difficulty: 1, effort: 1 },
  slower: {
    id: 'slower', name: 'Slower ball', styles: PACE, speedFactor: 0.78, swing: 0, seam: 0.6, turn: 0,
    sideSpinShare: 0, backspin: 1, difficulty: 1.25, effort: 0.8,
  },
  inswinger: { id: 'inswinger', name: 'Inswinger', styles: PACE, speedFactor: 0.97, swing: -1, seam: 0.6, turn: 0, sideSpinShare: 0, difficulty: 1.15, effort: 1 },
  outswinger: { id: 'outswinger', name: 'Outswinger', styles: PACE, speedFactor: 0.97, swing: 1, seam: 0.6, turn: 0, sideSpinShare: 0, difficulty: 1.15, effort: 1 },
  yorker: {
    id: 'yorker', name: 'Yorker', styles: PACE, speedFactor: 1.01, lengths: { min: 0.4, max: 1.3 },
    swing: 0, seam: 0.3, turn: 0, sideSpinShare: 0, difficulty: 1.6, effort: 1.15,
  },
  fullToss: {
    id: 'fullToss', name: 'Full toss', styles: [...PACE, ...ANY_SPIN], speedFactor: 0.98, fullToss: true,
    swing: 0, seam: 0, turn: 0, sideSpinShare: 0, difficulty: 0.9, effort: 0.9,
  },
  bouncer: {
    id: 'bouncer', name: 'Bouncer', styles: PACE, speedFactor: 1.02, lengths: { min: 9.5, max: 12.5 },
    swing: 0, seam: 0.5, turn: 0, sideSpinShare: 0, difficulty: 1.1, effort: 1.3,
  },
  offBreak: { id: 'offBreak', name: 'Off-break', styles: FINGER, speedFactor: 1, swing: 0, seam: 0.2, turn: 1, sideSpinShare: 0.8, difficulty: 1, effort: 0.6 },
  legBreak: { id: 'legBreak', name: 'Leg-break', styles: WRIST, speedFactor: 1, swing: 0, seam: 0.2, turn: 1, sideSpinShare: 0.8, difficulty: 1.15, effort: 0.6 },
  topSpinner: {
    id: 'topSpinner', name: 'Top-spinner', styles: ANY_SPIN, speedFactor: 1.04, swing: 0, seam: 0.2, turn: 1,
    sideSpinShare: 0.15, difficulty: 1.1, effort: 0.6,
  },
  doosra: { id: 'doosra', name: 'Doosra', styles: FINGER, speedFactor: 0.97, swing: 0, seam: 0.2, turn: -1, sideSpinShare: 0.75, difficulty: 1.5, effort: 0.7 },
  googly: { id: 'googly', name: 'Googly', styles: WRIST, speedFactor: 0.97, swing: 0, seam: 0.2, turn: -1, sideSpinShare: 0.7, difficulty: 1.4, effort: 0.7 },
};

export const deliveriesFor = (style: BowlingStyle): DeliveryTypeDef[] =>
  Object.values(DELIVERY_TYPES).filter((d) => d.styles.includes(style));

/** Named lengths, measured from the striker's stumps, for UI and AI. */
export const LENGTHS = {
  yorker: 0.9,
  full: 3,
  good: 5.5,
  backOfLength: 7.5,
  short: 9.5,
} as const;
