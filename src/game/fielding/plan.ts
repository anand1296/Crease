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
/** Fielders accelerate from standing; nobody reaches top speed in the first stride. */
export const FIELDER_ACCEL = 6;

/** Seconds to cover `d` metres from standing, accelerating to `vmax`. */
export function timeToCover(d: number, vmax: number, accel = FIELDER_ACCEL): number {
  if (d <= 0) return 0;
  const accelDistance = (vmax * vmax) / (2 * accel);
  return d <= accelDistance ? Math.sqrt((2 * d) / accel) : vmax / accel + (d - accelDistance) / vmax;
}
export const fielderReaction = (f: FieldingAttributes, close: boolean): number =>
  (close ? 0.12 : 0.35) + 0.2 * (1 - f.fielding / 100);

/** How far a fielder can reach without moving their feet: arms, or a dive. */
const STANDING_REACH = 0.9;
const DIVE_REACH = 1.8;
/** Highest point a fielder can take a catch (with a jump). */
const CATCH_HEIGHT = 2.6;
const MIN_CATCH_HEIGHT = 0.08;

/** Batters' running: call and start, then each run of ~17.7 m between creases. */
export const RUN = { start: 0.35, first: 2.95, subsequent: 3.0 } as const;
export const runTime = (n: number): number => (n <= 0 ? 0 : RUN.start + RUN.first + (n - 1) * RUN.subsequent);
/** Batters only take a run if they would make their ground with this much to spare. */
const SAFETY_MARGIN = 0.3;

export function buildField(fielders: readonly Player[], positions: readonly FieldPosition[], batterHand: Hand): Fielder[] {
  return positions.slice(0, fielders.length).map((position, i) => {
    const player = fielders[i];
    if (!player) throw new Error('not enough fielders');
    return { player, position, start: fieldPositionXZ(position, batterHand === 'left'), keeper: position.id === 'wk' };
  });
}

/**
 * Re-sets a field the way a captain does: each new position is filled by the
 * nearest fielder who is free, so a change of field moves people a few
 * metres rather than sending them across the ground. Close catching
 * positions (slips, gully, short leg) still go to the best catchers.
 * `previous` is where each fielder stood in the last field; anyone without
 * one falls back to `buildField`'s catching order.
 */
export function rebuildField(
  fielders: readonly Player[],
  positions: readonly FieldPosition[],
  batterHand: Hand,
  previous: ReadonlyMap<string, { readonly x: number; readonly z: number }>,
): Fielder[] {
  const first = buildField(fielders, positions, batterHand);
  // The first field of the innings: nobody is anywhere yet. (Someone new to the field — last
  // over's bowler — counts as standing mid-pitch, where he finished his over.)
  if (!fielders.some((p) => previous.has(p.id))) return first;
  const left = batterHand === 'left';
  const slots = positions.slice(0, fielders.length).map((position) => ({ position, xz: fieldPositionXZ(position, left), close: position.distance < 14 }));
  const taken = new Set<string>();
  const out = new Map<number, Fielder>();
  // Close catchers first, by catching ability (as in buildField's order).
  slots.forEach((slot, j) => {
    if (!slot.close) return;
    const best = fielders.filter((p) => !taken.has(p.id)).sort((a, b) => b.fielding.catching - a.fielding.catching)[0];
    if (!best) return;
    taken.add(best.id);
    out.set(j, { player: best, position: slot.position, start: slot.xz, keeper: false });
  });
  // Everyone else: the assignment with the least total squared distance (so nobody makes a long run
  // to save others a short one), found exactly with the Hungarian algorithm.
  const free = fielders.filter((p) => !taken.has(p.id));
  const open = slots.map((slot, j) => ({ slot, j })).filter(({ j }) => !out.has(j));
  const cost = free.map((p) => {
    const from = previous.get(p.id) ?? { x: 0, z: 0 };
    return open.map(({ slot }) => (from.x - slot.xz.x) ** 2 + (from.z - slot.xz.z) ** 2);
  });
  const match = hungarian(cost);
  match.forEach((col, row) => {
    const player = free[row];
    const target = open[col];
    if (player && target) out.set(target.j, { player, position: target.slot.position, start: target.slot.xz, keeper: false });
  });
  return slots.map((_, j) => out.get(j) ?? first[j]).filter((f): f is Fielder => f !== undefined);
}

/**
 * Minimum-cost assignment of rows to columns (Kuhn–Munkres, O(n³)) for a
 * square or wide matrix; returns the column assigned to each row.
 */
export function hungarian(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const m = Math.max(n, ...cost.map((r) => r.length));
  const INF = Number.POSITIVE_INFINITY;
  const c = (i: number, j: number) => cost[i - 1]?.[j - 1] ?? 0;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] ?? 0;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = c(i0, j) - (u[i0] ?? 0) - (v[j] ?? 0);
        if (cur < (minv[j] ?? INF)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] ?? INF) < delta) {
          delta = minv[j] ?? INF;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j] ?? 0] = (u[p[j] ?? 0] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else minv[j] = (minv[j] ?? INF) - delta;
      }
      j0 = j1;
    } while ((p[j0] ?? 0) !== 0);
    do {
      const j1 = way[j0] ?? 0;
      p[j0] = p[j1] ?? 0;
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if ((p[j] ?? 0) > 0) assignment[(p[j] ?? 1) - 1] = j - 1;
  return assignment;
}

interface Reach {
  readonly fielder: number;
  readonly sample: PathSample;
  /** Spare time: how long the fielder is in position before the ball arrives. */
  readonly spare: number;
  readonly dive: boolean;
}

/**
 * Earliest point on the path each fielder can get to, then the earliest of
 * all. A fielder dives only when a clean take is not available within half a
 * second — nobody dives at a ball they could simply walk in and collect.
 */
function firstReach(path: readonly PathSample[], field: readonly Fielder[], boundaryT: number | undefined): Reach | undefined {
  let best: Reach | undefined;
  const better = (a: Reach, b: Reach | undefined) =>
    !b || a.sample.t < b.sample.t || (a.sample.t === b.sample.t && (a.spare > b.spare || (b.dive && !a.dive)));
  field.forEach((f, i) => {
    const close = Math.hypot(f.start.x, f.start.z - STRIKER_STUMPS_Z) < 8;
    const speed = fielderSpeed(f.player.fielding);
    const reaction = fielderReaction(f.player.fielding, close);
    let dive: Reach | undefined;
    let clean: Reach | undefined;
    for (const s of path) {
      if (best && s.t > best.sample.t + (dive ? 0.5 : 0)) break;
      if (boundaryT !== undefined && s.t >= boundaryT) break;
      if (dive && s.t > dive.sample.t + 0.5) break;
      const airborne = !s.grounded;
      if (airborne && (s.y > CATCH_HEIGHT || s.y < MIN_CATCH_HEIGHT)) continue;
      if (!airborne && s.y > 0.6) continue;
      const d = Math.hypot(s.x - f.start.x, s.z - f.start.z);
      const run = Math.max(0, d - STANDING_REACH);
      const tNeeded = run > 0 ? reaction + timeToCover(run, speed) : reaction * 0.6;
      const spare = s.t - tNeeded;
      if (spare >= 0) {
        clean = { fielder: i, sample: s, spare, dive: false };
        break;
      }
      if (!dive) {
        // A dive buys extra reach at the cost of a harder take.
        const diveRun = Math.max(0, d - DIVE_REACH);
        if (s.t - (reaction + timeToCover(diveRun, speed)) >= 0) dive = { fielder: i, sample: s, spare: 0, dive: true };
      }
    }
    const candidate = clean ?? dive;
    if (candidate && better(candidate, best)) best = candidate;
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
      // Close catchers (keeper, slips) are there for fast edges: pace troubles them less.
      const paceFactor = f.keeper ? 0.4 : f.position.id.startsWith('slip') || f.position.id === 'gully' ? 0.6 : 1;
      const difficulty = clamp01(
        (reach.dive ? 0.55 : 0.2 - Math.min(0.2, reach.spare * 0.3)) + pace * paceFactor + (s.y > 2.2 ? 0.15 : 0),
      );
      const skill = f.player.fielding.catching / 100;
      const pHold = clamp01(0.97 - (1 - skill) * 0.25 - difficulty * (0.85 - 0.45 * skill));
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
      // Gathering a moving ball and setting to throw; longer after a dive.
      const pickup = 0.55 + (reach.dive ? 0.9 : 0) + delay;
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
  return 0.35 + d / speed;
}

export function safeRuns(returnT: number): number {
  let n = 0;
  while (n < 4 && runTime(n + 1) + SAFETY_MARGIN <= returnT) n++;
  return n;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
