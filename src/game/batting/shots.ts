/**
 * Shot catalogue. Every shot is a distinct set of physical intentions —
 * where the bat meets the ball, which ball positions it suits, how fast the
 * bat moves, which way the face points, how timing errors rotate the face —
 * and all of them go through the same contact physics (see contact.ts).
 *
 * Lateral values are batter-relative: positive = towards the batter's off
 * side. Angles are degrees from straight down the ground (0) towards the off
 * side (+90 = square on the off side, ±180 = straight behind).
 */
export type ShotId =
  | 'straightDrive'
  | 'coverDrive'
  | 'offDrive'
  | 'onDrive'
  | 'squareCut'
  | 'lateCut'
  | 'pull'
  | 'hook'
  | 'sweep'
  | 'reverseSweep'
  | 'flick'
  | 'legGlance'
  | 'block'
  | 'leave'
  | 'loftedDrive'
  | 'loftedAttack'
  | 'slogSweep';

/**
 * Front foot, back foot, or out of the crease: stepping down the pitch to
 * meet the ball on the full (or the half-volley), at the risk of being
 * stumped if it is missed.
 */
export type Footwork = 'front' | 'back' | 'out';

/** Extra time to get down the pitch before the bat comes down, seconds. */
export const STEP_OUT_TIME = 0.32;
/** How far down the pitch the batter gets, metres in front of the popping crease. */
const OUT = -1.75;

export type ShotKind = 'attack' | 'loft' | 'defence' | 'deflect' | 'sweep' | 'leave';

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface ShotDef {
  readonly id: ShotId;
  readonly name: string;
  readonly kind: ShotKind;
  /** Allowed footwork; the first is the shot's natural one. */
  readonly footwork: readonly [Footwork, ...Footwork[]];
  /** Intended horizontal direction, degrees. */
  readonly direction: number;
  /** Intended launch elevation, degrees (negative = into the ground). */
  readonly elevation: number;
  /** Bat speed at the sweet spot for a clean stroke, m/s (before the power attribute). */
  readonly batSpeed: number;
  /** Bat–ball coefficient of restitution at the sweet spot (lower = softer hands). */
  readonly restitution: number;
  /** Fraction of the ball's along-the-face velocity retained (friction, bat give). */
  readonly tangentialRetention: number;
  /**
   * Contact point along the pitch relative to the popping crease, metres,
   * per footwork. Negative = in front of the crease (towards the bowler).
   */
  readonly depth: Partial<Record<Footwork, number>>;
  /** Ball line at contact the shot suits (batter-relative, from middle stump). */
  readonly idealLine: Range;
  /** Ball height at contact the shot suits, metres. */
  readonly idealHeight: Range;
  /**
   * Timing tolerance as a distance along the ball's path, metres. The time
   * window is this divided by ball speed, so quicker balls are harder to time.
   */
  readonly timingTolerance: number;
  /** Seconds from committing to the stroke until the bat reaches the contact point. */
  readonly swingTime: number;
  /** Which way a late stroke rotates the direction (+1 towards the off side / finer on the off). */
  readonly lateDirection: 1 | -1;
  /** Degrees of direction change per unit of normalised timing error. */
  readonly timingTurnDeg: number;
  /** Elevation gained per metre the ball is above the shot's ideal height. */
  readonly riseWithHeightDeg: number;
}

const FRONT = -0.55;
const BACK = 0.45;

export const SHOTS: Readonly<Record<ShotId, ShotDef>> = {
  straightDrive: {
    id: 'straightDrive', name: 'Straight drive', kind: 'attack', footwork: ['front', 'back', 'out'],
    direction: 0, elevation: -5, batSpeed: 13, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: FRONT, back: BACK, out: OUT }, idealLine: { min: -0.08, max: 0.2 }, idealHeight: { min: 0.12, max: 0.55 },
    timingTolerance: 0.75, swingTime: 0.24, lateDirection: 1, timingTurnDeg: 10, riseWithHeightDeg: 30,
  },
  coverDrive: {
    id: 'coverDrive', name: 'Cover drive', kind: 'attack', footwork: ['front', 'out'],
    direction: 55, elevation: -5, batSpeed: 13.5, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: FRONT, out: OUT }, idealLine: { min: 0.15, max: 0.65 }, idealHeight: { min: 0.12, max: 0.55 },
    timingTolerance: 0.6, swingTime: 0.25, lateDirection: 1, timingTurnDeg: 18, riseWithHeightDeg: 35,
  },
  offDrive: {
    id: 'offDrive', name: 'Off drive', kind: 'attack', footwork: ['front', 'back'],
    direction: 22, elevation: -5, batSpeed: 13, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: FRONT, back: BACK }, idealLine: { min: 0.02, max: 0.4 }, idealHeight: { min: 0.12, max: 0.55 },
    timingTolerance: 0.7, swingTime: 0.24, lateDirection: 1, timingTurnDeg: 12, riseWithHeightDeg: 30,
  },
  onDrive: {
    id: 'onDrive', name: 'On drive', kind: 'attack', footwork: ['front', 'back', 'out'],
    direction: -20, elevation: -5, batSpeed: 13, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: FRONT, back: BACK, out: OUT }, idealLine: { min: -0.25, max: 0.08 }, idealHeight: { min: 0.12, max: 0.55 },
    timingTolerance: 0.6, swingTime: 0.24, lateDirection: 1, timingTurnDeg: 12, riseWithHeightDeg: 30,
  },
  squareCut: {
    id: 'squareCut', name: 'Square cut', kind: 'attack', footwork: ['back'],
    direction: 92, elevation: -3, batSpeed: 14, restitution: 0.42, tangentialRetention: 0.5,
    depth: { back: 0.5 }, idealLine: { min: 0.35, max: 1.05 }, idealHeight: { min: 0.4, max: 1.25 },
    timingTolerance: 0.55, swingTime: 0.2, lateDirection: 1, timingTurnDeg: 24, riseWithHeightDeg: 25,
  },
  lateCut: {
    id: 'lateCut', name: 'Late cut', kind: 'deflect', footwork: ['back', 'front'],
    direction: 145, elevation: -4, batSpeed: 5, restitution: 0.36, tangentialRetention: 0.75,
    depth: { back: 0.85, front: 0.2 }, idealLine: { min: 0.3, max: 0.85 }, idealHeight: { min: 0.3, max: 1.05 },
    timingTolerance: 0.4, swingTime: 0.17, lateDirection: 1, timingTurnDeg: 14, riseWithHeightDeg: 20,
  },
  pull: {
    id: 'pull', name: 'Pull', kind: 'attack', footwork: ['back'],
    direction: -78, elevation: 2, batSpeed: 15, restitution: 0.42, tangentialRetention: 0.5,
    depth: { back: 0.4 }, idealLine: { min: -0.35, max: 0.35 }, idealHeight: { min: 0.75, max: 1.45 },
    timingTolerance: 0.55, swingTime: 0.21, lateDirection: -1, timingTurnDeg: 22, riseWithHeightDeg: 18,
  },
  hook: {
    id: 'hook', name: 'Hook', kind: 'loft', footwork: ['back'],
    direction: -112, elevation: 24, batSpeed: 15, restitution: 0.42, tangentialRetention: 0.5,
    depth: { back: 0.5 }, idealLine: { min: -0.4, max: 0.3 }, idealHeight: { min: 1.2, max: 1.9 },
    timingTolerance: 0.45, swingTime: 0.2, lateDirection: -1, timingTurnDeg: 20, riseWithHeightDeg: 15,
  },
  sweep: {
    id: 'sweep', name: 'Sweep', kind: 'sweep', footwork: ['front'],
    direction: -95, elevation: -2, batSpeed: 16, restitution: 0.4, tangentialRetention: 0.55,
    depth: { front: -0.65 }, idealLine: { min: -0.45, max: 0.35 }, idealHeight: { min: 0, max: 0.55 },
    timingTolerance: 0.5, swingTime: 0.3, lateDirection: -1, timingTurnDeg: 18, riseWithHeightDeg: 40,
  },
  reverseSweep: {
    id: 'reverseSweep', name: 'Reverse sweep', kind: 'sweep', footwork: ['front'],
    direction: 100, elevation: -2, batSpeed: 14.5, restitution: 0.38, tangentialRetention: 0.55,
    depth: { front: -0.6 }, idealLine: { min: -0.1, max: 0.6 }, idealHeight: { min: 0, max: 0.55 },
    timingTolerance: 0.4, swingTime: 0.3, lateDirection: 1, timingTurnDeg: 20, riseWithHeightDeg: 40,
  },
  flick: {
    id: 'flick', name: 'Flick', kind: 'attack', footwork: ['front', 'back', 'out'],
    direction: -58, elevation: -3, batSpeed: 11.5, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: -0.35, back: 0.4, out: OUT }, idealLine: { min: -0.45, max: 0.05 }, idealHeight: { min: 0.1, max: 0.9 },
    timingTolerance: 0.55, swingTime: 0.2, lateDirection: -1, timingTurnDeg: 16, riseWithHeightDeg: 25,
  },
  legGlance: {
    id: 'legGlance', name: 'Leg glance', kind: 'deflect', footwork: ['front', 'back'],
    direction: -150, elevation: -3, batSpeed: 4, restitution: 0.36, tangentialRetention: 0.75,
    depth: { front: -0.2, back: 0.6 }, idealLine: { min: -0.5, max: 0 }, idealHeight: { min: 0.15, max: 1.1 },
    timingTolerance: 0.45, swingTime: 0.16, lateDirection: -1, timingTurnDeg: 14, riseWithHeightDeg: 20,
  },
  block: {
    id: 'block', name: 'Defensive block', kind: 'defence', footwork: ['front', 'back', 'out'],
    direction: 0, elevation: -28, batSpeed: 1.2, restitution: 0.16, tangentialRetention: 0.35,
    depth: { front: -0.45, back: BACK, out: OUT }, idealLine: { min: -0.3, max: 0.4 }, idealHeight: { min: 0, max: 1.2 },
    timingTolerance: 1.3, swingTime: 0.14, lateDirection: 1, timingTurnDeg: 8, riseWithHeightDeg: 12,
  },
  leave: {
    id: 'leave', name: 'Leave', kind: 'leave', footwork: ['front', 'back'],
    direction: 0, elevation: 0, batSpeed: 0, restitution: 0, tangentialRetention: 0,
    depth: { front: -0.3, back: BACK }, idealLine: { min: 0, max: 0 }, idealHeight: { min: 0, max: 0 },
    timingTolerance: 1, swingTime: 0.1, lateDirection: 1, timingTurnDeg: 0, riseWithHeightDeg: 0,
  },
  loftedDrive: {
    id: 'loftedDrive', name: 'Lofted drive', kind: 'loft', footwork: ['front', 'out'],
    direction: 0, elevation: 32, batSpeed: 17.5, restitution: 0.43, tangentialRetention: 0.55,
    depth: { front: FRONT, out: OUT }, idealLine: { min: -0.12, max: 0.35 }, idealHeight: { min: 0.12, max: 0.65 },
    timingTolerance: 0.55, swingTime: 0.28, lateDirection: 1, timingTurnDeg: 12, riseWithHeightDeg: 20,
  },
  loftedAttack: {
    id: 'loftedAttack', name: 'Lofted shot', kind: 'loft', footwork: ['front', 'back', 'out'],
    direction: 45, elevation: 30, batSpeed: 17.5, restitution: 0.43, tangentialRetention: 0.55,
    depth: { front: FRONT, back: BACK, out: OUT }, idealLine: { min: -0.4, max: 0.6 }, idealHeight: { min: 0.1, max: 1.1 },
    timingTolerance: 0.5, swingTime: 0.27, lateDirection: 1, timingTurnDeg: 16, riseWithHeightDeg: 18,
  },
  slogSweep: {
    id: 'slogSweep', name: 'Slog sweep', kind: 'sweep', footwork: ['front'],
    direction: -70, elevation: 26, batSpeed: 18, restitution: 0.42, tangentialRetention: 0.55,
    depth: { front: -0.75 }, idealLine: { min: -0.4, max: 0.4 }, idealHeight: { min: 0, max: 0.6 },
    timingTolerance: 0.42, swingTime: 0.3, lateDirection: -1, timingTurnDeg: 22, riseWithHeightDeg: 30,
  },
};

export const ALL_SHOTS: readonly ShotId[] = Object.values(SHOTS).map((s) => s.id);

/** A batter's chosen stroke for one delivery. */
export interface ShotAttempt {
  readonly shot: ShotId;
  readonly footwork: Footwork;
  /** Overrides the shot's direction (used by the lofted shot and the push, aimed by the input direction). */
  readonly aimDeg?: number;
  /**
   * Defensive push: the block played with a little more bat and placed into
   * a gap for a single, at a little more risk than a dead bat.
   */
  readonly push?: boolean;
}

export function attempt(shot: ShotId, footwork?: Footwork, aimDeg?: number): ShotAttempt {
  const def = SHOTS[shot];
  const fw = footwork && def.footwork.includes(footwork) ? footwork : def.footwork[0];
  return aimDeg === undefined ? { shot, footwork: fw } : { shot, footwork: fw, aimDeg };
}

/** A defensive push into a gap. */
export function push(aimDeg: number, footwork: Footwork = 'front'): ShotAttempt {
  return { shot: 'block', footwork, aimDeg, push: true };
}

/** Bat settings for a push, overriding the block's dead-bat values. */
export const PUSH = { batSpeed: 5, restitution: 0.26, elevation: -12, timingToleranceScale: 0.75 } as const;
