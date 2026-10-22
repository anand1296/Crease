import type { Rng } from '../core/rng.ts';
import type { Vec3 } from '../core/vec3.ts';
import { FIELD } from '../data/field.ts';

/**
 * Ball tracking for leg before wicket, and the Decision Review System.
 *
 * When the ball hits the pad (or body) the simulation knows its real path to
 * that point and can project it on to the stumps as if the batter were not
 * there. From that come the three things the third umpire looks at:
 *
 *  - Pitching: in line, outside off, or outside leg (outside leg is never out).
 *  - Impact: in line with the stumps, outside off (out only if no shot was
 *    offered), or outside leg (never out). Less than half the ball in line is
 *    "umpire's call".
 *  - Wickets: hitting, missing, or umpire's call when less than half the ball
 *    would hit the stumps (to the top of the bails since 2021), or when the
 *    impact is 3 m or more from the stumps.
 *
 * The on-field umpire does not have the tracking: he judges the same things
 * by eye, with errors that grow the further the ball had to travel after
 * hitting the pad. A review can overturn his decision only when the tracking
 * is clear; umpire's call keeps it, and the reviewing side keeps its review.
 * T20 internationals: two unsuccessful reviews per side per innings, asked
 * for within 15 seconds.
 */

export const REVIEWS_PER_INNINGS = 2;
export const REVIEW_WINDOW = 15;
/** Beyond this distance from impact to the stumps, the wickets verdict is at best umpire's call, m. */
export const LONG_PROJECTION = 3;

const HALF_WIDTH = FIELD.wicketWidth / 2;
const R = FIELD.ballRadius;
const TOP = FIELD.stumpHeight;

export type Pitching = 'inLine' | 'outsideOff' | 'outsideLeg' | 'full';
export type Impact = 'inLine' | 'umpiresCall' | 'outsideOff' | 'outsideLeg';
export type Wickets = 'hitting' | 'umpiresCall' | 'missing';
export type Decision = 'out' | 'notOut';

export interface LbwTracking {
  /** The ball's path from the bowler's hand to the impact, sampled. */
  readonly path: readonly Vec3[];
  /** The projected path from the impact on to the stumps. */
  readonly projection: readonly Vec3[];
  /** Where it pitched (a full toss did not). */
  readonly pitch: { readonly x: number; readonly z: number } | undefined;
  readonly impact: Vec3;
  /** Where the projection reaches the plane of the stumps (centre of the ball). */
  readonly atStumps: { readonly x: number; readonly y: number };
  /** +1 if the off side is +x (right-hander), −1 if not. */
  readonly off: 1 | -1;
  readonly shotOffered: boolean;
  /** Impact to the stumps, metres. */
  readonly distance: number;
  readonly pitching: Pitching;
  readonly impactZone: Impact;
  readonly wickets: Wickets;
}

/** Zones from positions (true or as an umpire perceives them). */
export function zones(
  pitchX: number | undefined,
  impactX: number,
  at: { x: number; y: number },
  off: 1 | -1,
  shotOffered: boolean,
  distance: number,
): { pitching: Pitching; impactZone: Impact; wickets: Wickets } {
  const p = pitchX === undefined ? undefined : pitchX * off;
  const pitching: Pitching = p === undefined ? 'full' : p < -HALF_WIDTH ? 'outsideLeg' : p > HALF_WIDTH ? 'outsideOff' : 'inLine';
  const i = impactX * off;
  const impactZone: Impact = Math.abs(i) <= HALF_WIDTH ? 'inLine' : Math.abs(i) < HALF_WIDTH + R ? 'umpiresCall' : i > 0 ? 'outsideOff' : 'outsideLeg';
  const ax = Math.abs(at.x);
  let wickets: Wickets;
  if (ax >= HALF_WIDTH + R || at.y >= TOP + R || at.y < -R) wickets = 'missing';
  else if (ax > HALF_WIDTH || at.y > TOP) wickets = 'umpiresCall';
  else wickets = 'hitting';
  if (wickets === 'hitting' && distance >= LONG_PROJECTION) wickets = 'umpiresCall';
  void shotOffered;
  return { pitching, impactZone, wickets };
}

/** What the tracking says: out, not out, or too close to overturn the umpire either way. */
export function verdict(t: Pick<LbwTracking, 'pitching' | 'impactZone' | 'wickets' | 'shotOffered'>): Decision | 'umpiresCall' {
  if (t.pitching === 'outsideLeg') return 'notOut';
  if (t.impactZone === 'outsideLeg') return 'notOut';
  if (t.impactZone === 'outsideOff' && t.shotOffered) return 'notOut';
  if (t.wickets === 'missing') return 'notOut';
  if (t.wickets === 'umpiresCall' || t.impactZone === 'umpiresCall') return 'umpiresCall';
  return 'out';
}

export interface Umpiring {
  readonly decision: Decision;
  /** Why not out, in the umpire's mind. */
  readonly reason: 'out' | 'pitched outside leg' | 'impact outside line' | 'missing stumps' | 'going over';
}

/**
 * The on-field umpire's decision by eye: the same judgement with errors —
 * a couple of centimetres on where it pitched and hit the pad, and more on
 * where it was going the further it had to travel. He gives it out only if
 * he believes it was hitting.
 */
export function umpireDecision(t: LbwTracking, rng: Rng): Umpiring {
  const d = t.distance;
  const sx = 0.02 + 0.025 * d;
  const sy = 0.03 + 0.03 * d;
  const pitchX = t.pitch ? t.pitch.x + rng.normal(0, 0.02) : undefined;
  const impactX = t.impact.x + rng.normal(0, 0.012);
  const at = { x: t.atStumps.x + rng.normal(0, sx), y: t.atStumps.y + rng.normal(0, sy) };
  const z = zones(pitchX, impactX, at, t.off, t.shotOffered, d);
  if (z.pitching === 'outsideLeg') return { decision: 'notOut', reason: 'pitched outside leg' };
  if (z.impactZone === 'outsideLeg' || (z.impactZone === 'outsideOff' && t.shotOffered) || z.impactZone === 'umpiresCall') {
    return { decision: 'notOut', reason: 'impact outside line' };
  }
  // A long way down the pitch, umpires give the batter the benefit of the doubt.
  if (d > 3.5) return { decision: 'notOut', reason: 'missing stumps' };
  if (Math.abs(at.x) > HALF_WIDTH) return { decision: 'notOut', reason: 'missing stumps' };
  if (at.y > TOP) return { decision: 'notOut', reason: 'going over' };
  return { decision: 'out', reason: 'out' };
}

export interface ReviewResult {
  readonly decision: Decision;
  readonly overturned: boolean;
  /** The reviewing side keeps its review (overturned, or umpire's call). */
  readonly retained: boolean;
  readonly umpiresCall: boolean;
}

/** The third umpire: the on-field decision stands unless the tracking clearly says otherwise. */
export function review(onField: Decision, t: LbwTracking): ReviewResult {
  const v = verdict(t);
  if (v === 'umpiresCall') return { decision: onField, overturned: false, retained: true, umpiresCall: true };
  if (v === onField) return { decision: onField, overturned: false, retained: false, umpiresCall: false };
  return { decision: v, overturned: true, retained: true, umpiresCall: false };
}

/**
 * How sure a side is that a review would go its way, from what its players
 * saw (the truth, blurred like the umpire's view): the chance the tracking
 * shows what they want, used by computer captains to decide whether to ask.
 */
export function reviewConfidence(onField: Decision, t: LbwTracking, rng: Rng, samples = 24): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const s = umpireDecision(t, rng);
    if (s.decision !== onField) wins++;
  }
  return wins / samples;
}

/** Builds the tracking record from the path so far and the projection. */
export function buildTracking(args: {
  path: readonly Vec3[];
  projection: readonly Vec3[];
  pitch: { x: number; z: number } | undefined;
  impact: Vec3;
  atStumps: { x: number; y: number };
  off: 1 | -1;
  shotOffered: boolean;
  stumpsZ: number;
}): LbwTracking {
  const distance = Math.max(0, args.stumpsZ - args.impact.z);
  return {
    path: args.path,
    projection: args.projection,
    pitch: args.pitch,
    impact: args.impact,
    atStumps: args.atStumps,
    off: args.off,
    shotOffered: args.shotOffered,
    distance,
    ...zones(args.pitch?.x, args.impact.x, args.atStumps, args.off, args.shotOffered, distance),
  };
}
