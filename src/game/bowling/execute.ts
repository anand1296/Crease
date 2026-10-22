import type { Rng } from '../core/rng.ts';
import { type Vec3, vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type PitchPreset, groundFor } from '../data/pitches.ts';
import { type BowlingStyle, type Hand, type Player, offSideSign } from '../model/player.ts';
import { type BallMovement, SPIN } from '../physics/ball.ts';
import { DELIVERY_TYPES, type DeliveryTypeDef, type DeliveryTypeId } from './deliveryTypes.ts';
import { type FlightSample, sampleFlight, solveLaunch } from './solver.ts';
import type { BowlingSide } from './runUp.ts';

/** What the bowler is trying to do. Lateral values are relative to the batter. */
export interface DeliveryPlan {
  readonly type: DeliveryTypeId;
  /** Where the ball should pass the stumps: metres from middle stump towards the batter's off side. */
  readonly line: number;
  /** Where the ball should pitch: metres in front of the striker's stumps. Ignored for full tosses. */
  readonly length: number;
  /**
   * Aim at a pitching spot instead of a line at the stumps (the human's
   * landing marker): metres from middle stump towards the batter's off side
   * where the ball should land. Swing bends the path to the spot; seam,
   * cut and turn take it on from there.
   */
  readonly pitchLine?: number;
  /** Over or around the wicket (default over). */
  readonly side?: BowlingSide;
  /** How much swing / cut / spin the bowler puts on it, 0–1 (default 0.5). */
  readonly amount?: number;
  /** Effort: 0 (rolled out) … 1 (flat out). Faster with effort, but control suffers near the top. Default 0.75. */
  readonly effort?: number;
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

/**
 * Release point. Over the wicket the bowling hand passes close to the
 * stumps (≈0.25 m from middle); around the wicket the bowler runs in on the
 * other side and the hand is wider (≈0.65 m), which angles the ball in.
 * World x: a right-armer bowling over the wicket releases at +x.
 */
export function releasePoint(bowler: Player, side: BowlingSide = 'over'): Vec3 {
  const spinner = bowler.bowlingStyle === 'offSpin' || bowler.bowlingStyle === 'legSpin';
  const arm = bowler.bowlingArm === 'right' ? 1 : -1;
  const x = side === 'over' ? arm * 0.25 : -arm * 0.65;
  // Heights as the player models reach them at release (arm vertical, hand above the head).
  return vec3(x, spinner ? 2.0 : 2.02, RELEASE_Z);
}

/** Speed multiplier for effort: 0.75 is the stock ball; flat out adds ≈3%, rolled out loses ≈10%. */
export const effortSpeed = (effort: number): number => 0.895 + 0.14 * clamp(effort, 0, 1);

/** Control lost when bowling flat out (above 85% effort). */
export const effortError = (effort: number): number => 1 + Math.max(0, clamp(effort, 0, 1) - 0.85) * 3;

export function canBowl(bowler: Player, type: DeliveryTypeId): boolean {
  return DELIVERY_TYPES[type].styles.includes(bowler.bowlingStyle);
}

/** Line/length error scale: accuracy, fatigue, delivery difficulty and release quality all matter. */
export function errorScale(ctx: Pick<ExecutionContext, 'bowler' | 'fatigue' | 'releaseQuality'>, def: DeliveryTypeDef): number {
  const acc = ctx.bowler.bowling.accuracy / 100;
  return (0.4 + (1 - acc) * 1.1) * def.difficulty * (1 + ctx.fatigue * 0.8) * (1 + (1 - ctx.releaseQuality) * 1.5);
}

/** Movement the bowler intends (used for aiming) — seam is unknowable, so it is excluded. */
/**
 * Movement the bowler intends (used for aiming) — seam is unknowable, so it
 * is excluded. `amount` (0–1) scales whatever the delivery varies: swing
 * (0.4×–1.2× the bowler's natural swing, capped at a realistic 6.5 m/s²,
 * i.e. up to ≈0.7 m of curve at 135 km/h), revolutions (0.65×–1.35×), or
 * the cut off the pitch (see executeDelivery).
 */
function intendedMovement(def: DeliveryTypeDef, ctx: ExecutionContext, speed: number, amount: number): BallMovement {
  const b = ctx.bowler.bowling;
  const offSign = offSideSign(ctx.batterHand);
  const swingScale = def.variable === 'swing' ? 0.4 + 0.8 * amount : 1;
  const swingAccel = clamp(def.swing * offSign * (1.6 + 3.4 * (b.swing / 100)) * ctx.pitch.swingConditions * Math.min(1, speed / 34) * swingScale, -6.5, 6.5);
  const spinScale = def.variable === 'spin' ? 0.65 + 0.7 * amount : 1;
  const revs = isSpinStyle(ctx.bowler.bowlingStyle) ? (17 + 15 * (b.spin / 100)) * spinScale : 0;
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
  const amount = clamp(plan.amount ?? 0.5, 0, 1);
  const effort = clamp(plan.effort ?? 0.75, 0, 1);
  // More revolutions mean more flight: a big-spinning delivery is a touch slower through the air.
  const flight = def.variable === 'spin' ? 1.04 - 0.08 * amount : 1;
  const intendedSpeed = stockSpeed(ctx.bowler.bowlingStyle, b.pace) * def.speedFactor * effortSpeed(effort) * flight * (1 - 0.06 * ctx.fatigue);
  const intendedMove = intendedMovement(def, ctx, intendedSpeed, amount);

  // --- Execution error (bounded, skill- and fatigue-dependent) ---
  // Trying to move it a lot, or bowling flat out, costs control.
  const scale = errorScale(ctx, def) * effortError(effort) * (def.variable === 'none' ? 1 : 0.85 + 0.3 * amount);
  const lineErr = rng.boundedNormal(0.085 * scale);
  const lengthErr = rng.boundedNormal((spinner ? 0.35 : 0.45) * scale);
  const speed = intendedSpeed + rng.boundedNormal(0.5 + 0.4 * scale);

  const actualMove: BallMovement = {
    // Swing is never exactly what was intended; sometimes it barely happens.
    swingAccel: intendedMove.swingAccel * clamp(1 + rng.boundedNormal(0.3), 0.1, 1.6) +
      (def.swing === 0 && !spinner ? rng.boundedNormal(0.6 * (b.swing / 100)) : 0),
    // Seam direction is random: the bowler cannot control which way it goes — except with a
    // cutter, where the fingers drag down one side of the ball and it grips and deviates that way
    // (0.5–1.8 m/s sideways off the pitch, ≈10–25 cm by the time it reaches the batter).
    seamDeltaV: spinner
      ? rng.boundedNormal(0.08)
      : (def.cut ?? 0) * offSign * (0.5 + 1.3 * amount) * (0.6 + 0.4 * (b.swing / 100)) * clamp(1 + rng.boundedNormal(0.25), 0.3, 1.5) +
        rng.boundedNormal(def.seam * (0.1 + 0.3 * (b.swing / 100))),
    spinSide: intendedMove.spinSide * clamp(1 + rng.boundedNormal(0.15), 0.5, 1.4),
    spinTop: intendedMove.spinTop * clamp(1 + rng.boundedNormal(0.15), 0.5, 1.4),
    bounceFactor: 1 + rng.boundedNormal(ctx.pitch.bounceVariability),
  };

  // --- Aim: where the ball must pitch so that, with intended movement, it passes at `line` ---
  const lineX = plan.line * offSign;
  const release = releasePoint(ctx.bowler, plan.side);
  let velocity: Vec3;
  if (plan.pitchLine !== undefined && !def.fullToss) {
    // The human's landing marker: aim straight at the spot (swing included in the aim).
    const pitchZ = STRIKER_STUMPS_Z - Math.max(0.2, length + lengthErr);
    velocity = solveLaunch(release, { x: plan.pitchLine * offSign + lineErr, z: pitchZ }, speed, intendedMove, ground);
  } else if (def.fullToss) {
    const height = 0.75 + rng.boundedNormal(0.12 * scale);
    velocity = solveLaunch(release, { x: lineX + lineErr, z: STRIKER_STUMPS_Z, fullTossHeight: height }, speed, intendedMove, ground);
  } else {
    // The bowler picks the pitching spot that, with the movement they expect
    // (angle from the crease, swing, drift and turn), finishes on their line.
    // Found by simulating the intended delivery and correcting the spot.
    const pitchZ = STRIKER_STUMPS_Z - Math.max(0.2, length + lengthErr);
    const expectedTurn = SPIN.turnPerRps * intendedMove.spinSide * ctx.pitch.surface.grip;
    let pitchX = lineX - expectedTurn * ((STRIKER_STUMPS_Z - pitchZ) / speed);
    // Moving the pitching spot sideways moves the finish further, because the
    // angle from the release point carries on after the bounce: the ratio is
    // (release→stumps) / (release→pitch), about 2 for a bouncer.
    const gain = (STRIKER_STUMPS_Z - release.z) / Math.max(1, pitchZ - release.z);
    for (let i = 0; i < 6; i++) {
      const v = solveLaunch(release, { x: pitchX, z: pitchZ }, speed, intendedMove, ground);
      const atStumps = sampleFlight(release, v, intendedMove, ground).atStumps;
      if (!atStumps) break;
      const miss = lineX - atStumps.x;
      if (Math.abs(miss) < 0.005) break;
      pitchX += miss / gain;
    }
    velocity = solveLaunch(release, { x: pitchX + lineErr, z: pitchZ }, speed, intendedMove, ground);
  }

  const acc = b.accuracy / 100;
  // Overstepping: more likely when tired, inaccurate, or bowling flat out.
  const noBall = rng.chance(0.004 + 0.025 * (1 - acc) * (0.5 + ctx.fatigue) + Math.max(0, effort - 0.9) * 0.25);
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
    intended: { line: plan.pitchLine ?? plan.line, length, speed: intendedSpeed },
    actual,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

