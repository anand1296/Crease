import type { Rng } from '../core/rng.ts';
import { type Vec3, vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type FieldPosition, fieldPositionXZ } from '../data/fieldPositions.ts';
import type { FieldingAttributes, Hand, Player } from '../model/player.ts';
import { type BallState, type GroundModel, cloneBall, newStepEvents, stepBall } from '../physics/ball.ts';

/**
 * Fielding resolution for a struck ball.
 *
 * The struck ball's path is projected with the real physics. Each fielder
 * can reach a point on that path if their reaction time plus running time
 * (both from attributes) is no more than the ball's time to get there.
 * The first fielder to get to the ball — in the air at catchable height, or
 * on the ground — determines what happens: a catch chance (held or dropped),
 * a pick-up (clean or fumbled), or nobody in time and the ball reaches the
 * boundary. Runs are those the batters can complete safely before the
 * return throw arrives.
 *
 * Nothing teleports: the plan records where and when each interception
 * happens, and the renderer runs the fielder there along the same timeline.
 */
export interface Fielder {
  readonly player: Player;
  readonly position: FieldPosition;
  readonly start: { readonly x: number; readonly z: number };
  readonly keeper: boolean;
}

export type FieldingKind = 'caught' | 'dropped' | 'fielded' | 'boundary';

export interface FieldingPlan {
  readonly kind: FieldingKind;
  /** Index into the fielders array (absent for a boundary nobody reached). */
  readonly fielder?: number;
  /** Seconds after contact at which the fielder meets the ball. */
  readonly interceptT: number;
  readonly interceptPos: Vec3;
  /** Boundary result, if the ball reached the rope. */
  readonly boundary?: 4 | 6;
  /** Runs completed by the batters (0 when caught; 4/6 when a boundary). */
  readonly runs: number;
  /** Seconds after contact at which the ball is back at a set of stumps (fielded only). */
  readonly returnT?: number;
  /** How difficult the chance or stop was, 0 (easy) – 1 (very hard). */
  readonly difficulty: number;
}

export interface PathSample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly speed: number;
  readonly grounded: boolean;
}

const SAMPLE_DT = 1 / 60;
const SIM_DT = 1 / 240;
const MAX_PATH_SECONDS = 14;

/** Projects a struck ball until it stops or crosses the boundary. */
export function projectPath(ball: Readonly<BallState>, ground?: GroundModel): { samples: PathSample[]; boundaryT?: number; six: boolean } {
  const b = cloneBall(ball);
  const ev = newStepEvents();
  const samples: PathSample[] = [];
  let t = 0;
  let bounced = false;
  let sinceSample = SAMPLE_DT;
  while (t < MAX_PATH_SECONDS && !b.atRest) {
    if (sinceSample >= SAMPLE_DT - 1e-9) {
      sinceSample = 0;
      samples.push({
        t,
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
        speed: Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z),
        grounded: b.position.y < 0.12 || bounced,
      });
    }
    stepBall(b, SIM_DT, ground, ev);
    if (ev.bounced) bounced = true;
    t += SIM_DT;
    sinceSample += SIM_DT;
    if (Math.hypot(b.position.x, b.position.z) >= FIELD.boundaryRadius) {
      return { samples, boundaryT: t, six: !bounced };
    }
  }
  return { samples, six: false };
}

export const fielderSpeed = (f: FieldingAttributes): number => 5.4 + 2.6 * (f.fielding / 100);
export const fielderReaction = (f: FieldingAttributes, close: boolean): number =>
  (close ? 0.12 : 0.35) + 0.2 * (1 - f.fielding / 100);

/** How far a fielder can reach without moving their feet: arms, or a dive. */
const STANDING_REACH = 0.9;
const DIVE_REACH = 1.8;
/** Highest point a fielder can take a catch (with a jump). */
const CATCH_HEIGHT = 2.6;
const MIN_CATCH_HEIGHT = 0.08;

/** Batters' running: call and start, then each run of ~17.7 m between creases. */
export const RUN = { start: 0.6, first: 3.1, subsequent: 3.15 } as const;
export const runTime = (n: number): number => (n <= 0 ? 0 : RUN.start + RUN.first + (n - 1) * RUN.subsequent);
/** Batters only take a run if they would make their ground with this much to spare. */
const SAFETY_MARGIN = 0.45;

export function buildField(fielders: readonly Player[], positions: readonly FieldPosition[], batterHand: Hand): Fielder[] {
  return positions.slice(0, fielders.length).map((position, i) => {
    const player = fielders[i];
    if (!player) throw new Error('not enough fielders');
    return { player, position, start: fieldPositionXZ(position, batterHand === 'left'), keeper: position.id === 'wk' };
  });
}

interface Reach {
  readonly fielder: number;
  readonly sample: PathSample;
  /** Spare time: how long the fielder is in position before the ball arrives. */
  readonly spare: number;
  readonly dive: boolean;
}

/** Earliest point on the path each fielder can get to, then the earliest of all. */
function firstReach(path: readonly PathSample[], field: readonly Fielder[], boundaryT: number | undefined): Reach | undefined {
  let best: Reach | undefined;
  field.forEach((f, i) => {
    const close = Math.hypot(f.start.x, f.start.z - STRIKER_STUMPS_Z) < 8;
    const speed = fielderSpeed(f.player.fielding);
    const reaction = fielderReaction(f.player.fielding, close);
    for (const s of path) {
      // Later than the current best: this fielder cannot be first. At the same
      // instant, the fielder with more time to settle under it takes it.
      if (best && s.t > best.sample.t) break;
      if (boundaryT !== undefined && s.t >= boundaryT) break;
      const airborne = !s.grounded;
      if (airborne && (s.y > CATCH_HEIGHT || s.y < MIN_CATCH_HEIGHT)) continue;
      if (!airborne && s.y > 0.6) continue;
      const d = Math.hypot(s.x - f.start.x, s.z - f.start.z);
      const run = Math.max(0, d - STANDING_REACH);
      const tNeeded = run > 0 ? reaction + run / speed : reaction * 0.6;
      const spare = s.t - tNeeded;
      const tie = best !== undefined && s.t === best.sample.t;
      if (spare >= 0) {
        if (!tie || !best || spare > best.spare || best.dive) best = { fielder: i, sample: s, spare, dive: false };
        break;
      }
      // A dive buys extra reach at the cost of a harder take.
      const diveRun = Math.max(0, d - DIVE_REACH);
      const tDive = reaction + diveRun / speed;
      if (s.t - tDive >= 0) {
        if (!tie) best = { fielder: i, sample: s, spare: 0, dive: true };
        break;
      }
    }
  });
  return best;
}

export function planFielding(
  struckBall: Readonly<BallState>,
  field: readonly Fielder[],
  rng: Rng,
  ground?: GroundModel,
): FieldingPlan {
  const { samples, boundaryT, six } = projectPath(struckBall, ground);
  let path = samples;
  let delay = 0;
  // Up to two attempts: a fumble lets the ball run on to the next fielder.
  for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
    const reach = firstReach(path, field, boundaryT);
    if (!reach) break;
    const f = field[reach.fielder];
    if (!f) break;
    const s = reach.sample;
    const pos = vec3(s.x, s.y, s.z);
    const pace = Math.max(0, s.speed - 18) / 25;
    if (!s.grounded) {
      // Catch chance.
      const difficulty = clamp01((reach.dive ? 0.55 : 0.25 - Math.min(0.25, reach.spare * 0.3)) + pace + (s.y > 2.2 ? 0.15 : 0));
      const skill = f.player.fielding.catching / 100;
      const pHold = clamp01(0.55 + 0.45 * skill - difficulty * (1.15 - 0.5 * skill));
      if (rng.chance(pHold)) {
        return { kind: 'caught', fielder: reach.fielder, interceptT: s.t, interceptPos: pos, runs: 0, difficulty };
      }
      // Dropped: the ball falls near the fielder and is picked up.
      const returnT = s.t + delay + 1.1 + throwTime(f, pos);
      return {
        kind: 'dropped', fielder: reach.fielder, interceptT: s.t, interceptPos: { ...pos, y: FIELD.ballRadius },
        runs: safeRuns(returnT), returnT, difficulty,
      };
    }
    // Ground fielding: a clean stop is harder off a quick ball or a dive.
    const difficulty = clamp01((reach.dive ? 0.45 : 0.1) + pace);
    const pClean = clamp01(0.9 + 0.1 * (f.player.fielding.fielding / 100) - difficulty * 0.55);
    if (rng.chance(pClean) || attemptNo === 2) {
      const pickup = 0.35 + (reach.dive ? 0.6 : 0) + delay;
      const returnT = s.t + pickup + throwTime(f, pos);
      return { kind: 'fielded', fielder: reach.fielder, interceptT: s.t, interceptPos: pos, runs: safeRuns(returnT), returnT, difficulty };
    }
    // Fumble: the ball slows and runs on; others may still get to it.
    delay += 0.8;
    path = path.filter((p) => p.t > s.t).map((p) => ({ ...p, speed: p.speed * 0.6 }));
  }
  const end = samples.at(-1);
  if (boundaryT !== undefined) {
    return {
      kind: 'boundary', interceptT: boundaryT, interceptPos: end ? vec3(end.x, end.y, end.z) : vec3(),
      boundary: six ? 6 : 4, runs: six ? 6 : 4, difficulty: 0,
    };
  }
  // Nobody could get there and it stopped in the field (very rare): the nearest fielder walks to it.
  const restT = end?.t ?? 0;
  return { kind: 'fielded', interceptT: restT + 4, interceptPos: end ? vec3(end.x, end.y, end.z) : vec3(), runs: safeRuns(restT + 6), difficulty: 0 };
}

/** Time for the return throw to reach the nearer set of stumps. */
function throwTime(f: Fielder, pos: Readonly<Vec3>): number {
  const toStriker = Math.hypot(pos.x, pos.z - STRIKER_STUMPS_Z);
  const toBowler = Math.hypot(pos.x, pos.z - BOWLER_STUMPS_Z);
  const d = Math.min(toStriker, toBowler);
  const speed = 20 + 12 * (f.player.fielding.throwing / 100);
  return 0.25 + d / speed;
}

export function safeRuns(returnT: number): number {
  let n = 0;
  while (n < 4 && runTime(n + 1) + SAFETY_MARGIN <= returnT) n++;
  return n;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
