import type { Rng } from '../core/rng.ts';
import { type Vec3, vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type PitchPreset, groundFor } from '../data/pitches.ts';
import { type BowlingStyle, type Hand, type Player, offSideSign } from '../model/player.ts';
import { type BallMovement, SPIN } from '../physics/ball.ts';
import { DELIVERY_TYPES, type DeliveryTypeDef, type DeliveryTypeId } from './deliveryTypes.ts';
import { type FlightSample, sampleFlight, solveLaunch } from './solver.ts';

/** What the bowler is trying to do. Lateral values are relative to the batter. */
export interface DeliveryPlan {
  readonly type: DeliveryTypeId;
  /** Where the ball should pass the stumps: metres from middle stump towards the batter's off side. */
  readonly line: number;
  /** Where the ball should pitch: metres in front of the striker's stumps. Ignored for full tosses. */
  readonly length: number;
}

export interface ExecutionContext {
  readonly bowler: Player;
  readonly batterHand: Hand;
  readonly pitch: PitchPreset;
  /** 0 fresh … 1 exhausted. */
  readonly fatigue: number;
  /**
   * Quality of the release from the bowling input (user's accuracy meter, or
   * the AI's execution roll), 0–1. 1 means a perfectly timed release.
   */
  readonly releaseQuality: number;
  readonly rng: Rng;
}

/** The delivery as actually bowled. The physics takes it from here. */
export interface ExecutedDelivery {
  readonly plan: DeliveryPlan;
  readonly type: DeliveryTypeDef;
  readonly release: Vec3;
  readonly velocity: Vec3;
  readonly movement: BallMovement;
  readonly releaseSpeedKph: number;
  readonly noBall: boolean;
  /** Intended pitching point / line in world coordinates. */
  readonly intended: { readonly line: number; readonly length: number; readonly speed: number };
  /** Where it actually pitched and passed the stumps, from simulating the bowled ball. */
  readonly actual: FlightSample;
}

const RELEASE_Z = BOWLER_STUMPS_Z + 1.05;

/** Stock (horizontal) release speed in m/s for a style and pace attribute. */
export function stockSpeed(style: BowlingStyle, pace: number): number {
  const p = pace / 100;
  switch (style) {
    case 'fast':
      return 34 + 8 * p;
    case 'fastMedium':
      return 31 + 6.5 * p;
    case 'medium':
      return 28 + 5 * p;
    case 'offSpin':
      return 20.5 + 3.5 * p;
    case 'legSpin':
      return 20 + 3.5 * p;
    case 'none':
      return 26;
  }
}

/**
 * Direction of the bowler's stock turn in world x: right-arm off-spin turns
 * towards −x (into a right-hander), right-arm leg-spin towards +x; left-armers
 * are mirrored.
 */
export function stockTurnSign(style: BowlingStyle, arm: Hand): number {
  const base = style === 'offSpin' ? -1 : style === 'legSpin' ? 1 : 0;
  return arm === 'right' ? base : -base;
}

/** Release point for an over-the-wicket delivery. */
export function releasePoint(bowler: Player): Vec3 {
  const spinner = bowler.bowlingStyle === 'offSpin' || bowler.bowlingStyle === 'legSpin';
  const x = bowler.bowlingArm === 'right' ? 0.22 : -0.22;
  return vec3(x, spinner ? 2.0 : 2.15, RELEASE_Z);
}

export function canBowl(bowler: Player, type: DeliveryTypeId): boolean {
  return DELIVERY_TYPES[type].styles.includes(bowler.bowlingStyle);
}

/** Line/length error scale: accuracy, fatigue, delivery difficulty and release quality all matter. */
export function errorScale(ctx: Pick<ExecutionContext, 'bowler' | 'fatigue' | 'releaseQuality'>, def: DeliveryTypeDef): number {
  const acc = ctx.bowler.bowling.accuracy / 100;
  return (0.4 + (1 - acc) * 1.1) * def.difficulty * (1 + ctx.fatigue * 0.8) * (1 + (1 - ctx.releaseQuality) * 1.5);
}

/** Movement the bowler intends (used for aiming) — seam is unknowable, so it is excluded. */
function intendedMovement(def: DeliveryTypeDef, ctx: ExecutionContext, speed: number): BallMovement {
  const b = ctx.bowler.bowling;
  const offSign = offSideSign(ctx.batterHand);
  const swingAccel = def.swing * offSign * (1.6 + 3.4 * (b.swing / 100)) * ctx.pitch.swingConditions * Math.min(1, speed / 34);
  const revs = isSpinStyle(ctx.bowler.bowlingStyle) ? 17 + 15 * (b.spin / 100) : 0;
  const turnSign = stockTurnSign(ctx.bowler.bowlingStyle, ctx.bowler.bowlingArm) * def.turn;
  const spinSide = revs * def.sideSpinShare * turnSign;
  const spinTop = revs * (1 - def.sideSpinShare) - (def.backspin ?? 0) * 12;
  return { swingAccel, seamDeltaV: 0, spinSide, spinTop, bounceFactor: 1 };
}

const isSpinStyle = (s: BowlingStyle) => s === 'offSpin' || s === 'legSpin';

/**
 * Turns a plan into a bowled ball. The bowler aims using the movement they
 * intend; the ball then gets the movement it actually has (more or less
 * swing, random seam, variable bounce), plus line/length/speed error. The
 * gap between intention and execution comes from attributes, fatigue and
 * release quality, never from hidden result manipulation.
 */
export function executeDelivery(plan: DeliveryPlan, ctx: ExecutionContext): ExecutedDelivery {
  const def = DELIVERY_TYPES[plan.type];
  if (!def.styles.includes(ctx.bowler.bowlingStyle)) {
    throw new Error(`${ctx.bowler.name} (${ctx.bowler.bowlingStyle}) cannot bowl a ${def.name}`);
  }
  const rng = ctx.rng;
  const ground = groundFor(ctx.pitch);
  const offSign = offSideSign(ctx.batterHand);
  const b = ctx.bowler.bowling;
  const spinner = isSpinStyle(ctx.bowler.bowlingStyle);

  const length = def.lengths ? clamp(plan.length, def.lengths.min, def.lengths.max) : plan.length;
  const intendedSpeed = stockSpeed(ctx.bowler.bowlingStyle, b.pace) * def.speedFactor * (1 - 0.06 * ctx.fatigue);
  const intendedMove = intendedMovement(def, ctx, intendedSpeed);

  // --- Execution error (bounded, skill- and fatigue-dependent) ---
  const scale = errorScale(ctx, def);
  const lineErr = rng.boundedNormal(0.085 * scale);
  const lengthErr = rng.boundedNormal((spinner ? 0.35 : 0.45) * scale);
  const speed = intendedSpeed + rng.boundedNormal(0.5 + 0.4 * scale);

  const actualMove: BallMovement = {
    // Swing is never exactly what was intended; sometimes it barely happens.
    swingAccel: intendedMove.swingAccel * clamp(1 + rng.boundedNormal(0.3), 0.1, 1.6) +
      (def.swing === 0 && !spinner ? rng.boundedNormal(0.6 * (b.swing / 100)) : 0),
    // Seam direction is random: the bowler cannot control which way it goes.
    seamDeltaV: spinner ? rng.boundedNormal(0.15) : rng.boundedNormal(def.seam * (0.25 + 0.75 * (b.swing / 100))),
    spinSide: intendedMove.spinSide * clamp(1 + rng.boundedNormal(0.15), 0.5, 1.4),
    spinTop: intendedMove.spinTop * clamp(1 + rng.boundedNormal(0.15), 0.5, 1.4),
    bounceFactor: 1 + rng.boundedNormal(ctx.pitch.bounceVariability),
  };

  // --- Aim: where the ball must pitch so that, with intended movement, it passes at `line` ---
  const lineX = plan.line * offSign;
  const release = releasePoint(ctx.bowler);
  let velocity: Vec3;
  if (def.fullToss) {
    const height = 0.75 + rng.boundedNormal(0.12 * scale);
    velocity = solveLaunch(release, { x: lineX + lineErr, z: STRIKER_STUMPS_Z, fullTossHeight: height }, speed, intendedMove, ground);
  } else {
    // The bowler picks the pitching spot that, with the movement they expect
    // (angle from the crease, swing, drift and turn), finishes on their line.
    // Found by simulating the intended delivery and correcting the spot.
    const pitchZ = STRIKER_STUMPS_Z - Math.max(0.2, length + lengthErr);
    const expectedTurn = SPIN.turnPerRps * intendedMove.spinSide * ctx.pitch.surface.grip;
    let pitchX = lineX - expectedTurn * ((STRIKER_STUMPS_Z - pitchZ) / speed);
    for (let i = 0; i < 4; i++) {
      const v = solveLaunch(release, { x: pitchX, z: pitchZ }, speed, intendedMove, ground);
      const atStumps = sampleFlight(release, v, intendedMove, ground).atStumps;
      if (!atStumps) break;
      const miss = lineX - atStumps.x;
      if (Math.abs(miss) < 0.005) break;
      // Moving the pitching spot moves the finish by roughly the same amount.
      pitchX += miss;
    }
    velocity = solveLaunch(release, { x: pitchX + lineErr, z: pitchZ }, speed, intendedMove, ground);
  }

  const acc = b.accuracy / 100;
  const noBall = rng.chance(0.004 + 0.025 * (1 - acc) * (0.5 + ctx.fatigue));
  const actual = sampleFlight(release, velocity, actualMove, ground);
  const releaseSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);

  return {
    plan: { ...plan, length },
    type: def,
    release,
    velocity,
    movement: actualMove,
    releaseSpeedKph: releaseSpeed * 3.6,
    noBall,
    intended: { line: plan.line, length, speed: intendedSpeed },
    actual,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

