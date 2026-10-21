import type { Rng } from '../core/rng.ts';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import type { GroundModel } from '../physics/ball.ts';
import { contactPlaneZ } from '../batting/body.ts';
import { SHOTS, type ShotAttempt, attempt, push } from '../batting/shots.ts';
import type { ExecutedDelivery } from '../bowling/execute.ts';
import type { Difficulty } from '../model/difficulty.ts';
import { type Player, offSideSign } from '../model/player.ts';
import { predictArrival } from '../simulation/ballInPlay.ts';

/**
 * Computer batter (P1 version).
 *
 * No omniscience: the AI "reads" the delivery only after a perception delay
 * and with errors in line, length and pace that grow with lower technique,
 * difficulty and the delivery's disguise (a slower ball can fool it). It
 * picks a stroke suited to what it *thinks* is coming, then commits with a
 * timing error drawn from its timing attribute. Its stroke then goes through
 * exactly the same contact physics as the human's.
 */
export interface BattingDecision {
  readonly attempt: ShotAttempt;
  /** Seconds after release at which to commit to the stroke. */
  readonly commitAt: number;
  /** What it perceived, for debugging and tests. */
  readonly perceived: { readonly line: number; readonly length: number; readonly speed: number };
}

/** Seconds of flight the AI needs to watch before it can judge the ball. */
const READ_TIME = 0.14;

export interface BattingAiOptions {
  readonly batter: Player;
  readonly difficulty: Difficulty;
  /** How positive the batter should be, −1 (survive) … +1 (attack). P3 sets this from the match situation. */
  readonly intent: number;
  readonly rng: Rng;
  readonly ground: GroundModel;
  /** Where the deep field has gaps, batter-relative degrees (see `deepGaps`). */
  readonly gaps?: Gaps | undefined;
}

export interface Gaps {
  readonly off: number;
  readonly leg: number;
  /** Gaps in the ring (for pushes and drives along the ground). */
  readonly ringOff?: number;
  readonly ringLeg?: number;
}

/**
 * Reading the field: the middle of the widest gap between the boundary
 * fielders on each side (batter-relative degrees, + off side), where a
 * lofted shot is safest.
 */
export function deepGaps(deepAngles: readonly number[], ringAngles: readonly number[] = []): Gaps {
  const best = (from: number, to: number, angles: readonly number[] = deepAngles) => {
    let angle = (from + to) / 2;
    let clearance = -1;
    for (let a = from; a <= to; a += 2) {
      const c = angles.reduce((m, d) => Math.min(m, Math.abs(d - a)), 90);
      if (c > clearance) {
        clearance = c;
        angle = a;
      }
    }
    return angle;
  };
  return { off: best(8, 110), leg: best(-110, -8), ...(ringAngles.length ? { ringOff: best(15, 110, ringAngles), ringLeg: best(-110, -15, ringAngles) } : {}) };
}

export function decideStroke(delivery: ExecutedDelivery, o: BattingAiOptions): BattingDecision | null {
  const { batter, difficulty, rng } = o;
  const bat = batter.batting;
  const off = offSideSign(batter.battingHand);
  const actualPitch = delivery.actual.pitch;
  const atStumps = delivery.actual.atStumps;
  if (!atStumps) return null;

  // --- Perception (bounded, skill-scaled) ---
  const misread = (1.3 - bat.technique / 100) * difficulty.perceptionError;
  const disguise = delivery.type.id === 'slower' || delivery.type.id === 'doosra' || delivery.type.id === 'googly' ? 1 : 0;
  // A disguised ball is read as the stock ball unless the batter picks it.
  const picked = rng.chance(0.25 + 0.6 * (bat.technique / 100) / difficulty.perceptionError);
  const speedError = disguise && !picked ? (delivery.type.id === 'slower' ? 0.2 : 0) : 0;
  const lengthTrue = actualPitch ? STRIKER_STUMPS_Z - actualPitch.z : -0.5;
  const length = lengthTrue + rng.boundedNormal(0.35 * misread);
  // Seam movement off the pitch cannot be anticipated, only reacted to — and
  // only if there is time between the bounce and the ball arriving.
  const afterBounce = actualPitch ? atStumps.t - actualPitch.t : 0;
  const canAdjust = Math.min(1, Math.max(0, (afterBounce - 0.18) / 0.2));
  const seamShift = delivery.movement.seamDeltaV * o.ground.pitch.seam * afterBounce;
  const line =
    (atStumps.x - seamShift * (1 - canAdjust)) * off +
    rng.boundedNormal(0.06 * misread) +
    (disguise && !picked && delivery.type.id !== 'slower' ? -0.15 : 0);

  const shot = chooseShot(line, length, atStumps.y, o.intent, rng, o.gaps);

  // --- Timing ---
  const planeZ = contactPlaneZ(shot, bat.footwork, actualPitch?.z);
  const arrival = predictArrival(delivery, planeZ, o.ground);
  if (!arrival) return null;
  const perceivedArrival = arrival.t * (1 - speedError);
  const sigma = (0.012 + 0.03 * (1 - bat.timing / 100)) * difficulty.executionError;
  const commitAt = Math.max(READ_TIME + difficulty.reactionDelay, perceivedArrival - SHOTS[shot.shot].swingTime + rng.boundedNormal(sigma));
  return { attempt: shot, commitAt, perceived: { line, length, speed: arrival.speed * (1 + speedError) } };
}

/** Shot selection from the perceived line (batter-relative), length and height at the stumps. */
export function chooseShot(line: number, length: number, heightAtStumps: number, intent: number, rng: Rng, gaps?: Gaps): ShotAttempt {
  // Lofted shots go where the boundary fielders are not.
  const legGap = gaps?.leg ?? -40;
  const offGap = gaps?.off ?? 35;
  const aggressive = rng.chance(0.35 + 0.35 * Math.min(1, intent));
  // Above 1: T20 hitting — clearing the ring off good-length balls too.
  const slog = Math.max(0, intent - 1);
  const wide = line > 0.45;
  const legSide = line < -0.12;

  if (length < 0) {
    // Full toss.
    return line > 0.15 ? attempt('coverDrive') : legSide ? attempt('flick') : aggressive ? attempt('loftedDrive') : attempt('straightDrive');
  }
  if (length <= 1.5) {
    // Yorker length: dig it out.
    return attempt(aggressive && legSide ? 'flick' : 'block', 'front');
  }
  if (length < 4) {
    // Full / half-volley: drive.
    if (wide) return aggressive ? attempt('coverDrive') : attempt('leave');
    if (legSide) return attempt(aggressive ? 'flick' : 'onDrive');
    if (aggressive && rng.chance(0.25 + 0.25 * Math.min(1, intent) + 0.5 * slog)) {
      if (gaps) return attempt('loftedAttack', 'front', line < 0.05 ? legGap : offGap);
      return line < 0.05 && rng.chance(0.4) ? attempt('loftedAttack', 'front', -40) : attempt('loftedDrive');
    }
    return attempt(line > 0.15 ? 'coverDrive' : line > 0.03 ? 'offDrive' : 'straightDrive');
  }
  if (length < 7.5) {
    // Good length: respect it, but look to work it into a gap for a single.
    const fw = length > 6 ? 'back' : 'front';
    if (slog > 0 && rng.chance(slog * 1.1)) {
      // Into the arc: over midwicket off the stumps, over cover from outside off.
      return line > 0.15 ? attempt('loftedAttack', 'front', offGap) : attempt('loftedAttack', fw, gaps ? legGap : -45);
    }
    if (wide) return attempt('leave', 'front');
    if (legSide) return aggressive ? attempt('flick', fw) : push(-40, fw);
    if (aggressive && line > 0.2 && length < 5) return attempt('coverDrive');
    if (rng.chance(0.55 + 0.3 * Math.min(1, intent))) return push(line > 0.08 ? (gaps?.ringOff ?? 35) : (gaps?.ringLeg ?? -38), fw);
    return attempt('block', fw);
  }
  // Short.
  if (heightAtStumps > 1.7) return slog > 0.3 && line < 0.3 && rng.chance(slog) ? attempt('hook') : attempt('leave', 'back');
  if (line > 0.3) return attempt(aggressive ? 'squareCut' : 'leave', 'back');
  if (heightAtStumps > 1.1) return aggressive ? attempt('pull') : attempt('block', 'back');
  return aggressive ? attempt('pull') : push(line > 0.1 ? 60 : -60, 'back');
}
