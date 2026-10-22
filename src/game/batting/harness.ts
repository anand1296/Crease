import { Rng } from '../core/rng.ts';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import { PITCHES, type PitchId, groundFor } from '../data/pitches.ts';
import { type DeliveryPlan, executeDelivery } from '../bowling/execute.ts';
import type { Player } from '../model/player.ts';
import { type BallEvent, BallInPlay, predictArrival } from '../simulation/ballInPlay.ts';
import { contactPlaneZ } from './body.ts';
import type { ContactKind, EdgeKind } from './contact.ts';
import { SHOTS, type ShotAttempt } from './shots.ts';

/**
 * Headless stroke simulation: bowl a delivery, commit to a stroke with a
 * given timing error, run the ball to its end. Used by the batting tests and
 * the distribution report — the same code path the game uses.
 */
export interface StrokeScenario {
  readonly bowler: Player;
  readonly batter: Player;
  readonly plan: DeliveryPlan;
  readonly attempt: ShotAttempt;
  /** Bat arrival relative to perfect, milliseconds (positive = late). */
  readonly timingMs: number;
  readonly pitch?: PitchId;
  readonly seed: string | number;
  /** Fix the delivery (same ball every time) and vary only the stroke's randomness. */
  readonly deliverySeed?: string | number;
}

/** Whether the bat touched the ball before time `t`. */
function struckFirst(events: readonly BallEvent[], t: number): boolean {
  return events.some((e) => e.type === 'contact' && e.t < t);
}

export type StrokeEnd = 'boundary4' | 'boundary6' | 'stopped' | 'bowled' | 'pad' | 'body' | 'passed' | 'other';

export interface StrokeSummary {
  readonly kind: ContactKind | 'none';
  readonly edge?: EdgeKind;
  readonly quality: number;
  readonly exitSpeed: number;
  readonly directionDeg: number;
  readonly elevationDeg: number;
  /** Distance from the striker's stumps to the first bounce after contact (or to where it ended if it never bounced). */
  readonly carry: number;
  readonly apex: number;
  readonly end: StrokeEnd;
  /** Distance from the striker's stumps where the ball ended. */
  readonly distance: number;
  /** True if the ball was in the air above 0.3 m beyond 12 m from the bat: a catchable chance. */
  readonly airborneChance: boolean;
}

export function simulateStroke(s: StrokeScenario): StrokeSummary {
  const pitch = PITCHES[s.pitch ?? 'balanced'];
  const ground = groundFor(pitch);
  const delivery = executeDelivery(s.plan, {
    bowler: s.bowler,
    batterHand: s.batter.battingHand,
    pitch,
    fatigue: 0,
    releaseQuality: 1,
    rng: new Rng(`delivery:${String(s.deliverySeed ?? s.seed)}`),
  });
  const planeZ = contactPlaneZ(s.attempt, s.batter.batting.footwork, delivery.actual.pitch?.z);
  const arrival = predictArrival(delivery, planeZ, ground);
  const play = new BallInPlay({ delivery, striker: s.batter, ground, rng: new Rng(`stroke:${String(s.seed)}`) });
  const press = (arrival?.t ?? 0.5) - SHOTS[s.attempt.shot].swingTime + s.timingMs / 1000;

  let airborneChance = false;
  const dt = 1 / 240;
  while (play.phase !== 'dead' && play.time < 20) {
    if (play.canPlayShot && play.time >= press) play.playShot(s.attempt, press);
    play.step(dt);
    if (play.phase === 'struck' && !play.firstBounceAfterContact) {
      const p = play.ball.position;
      if (p.y > 0.3 && Math.hypot(p.x, p.z - STRIKER_STUMPS_Z) > 12) airborneChance = true;
    }
  }

  const c = play.contact;
  const last = play.events.at(-1);
  const endPos = play.ball.position;
  const fb = play.firstBounceAfterContact;
  const dist = (x: number, z: number) => Math.hypot(x, z - STRIKER_STUMPS_Z);
  let end: StrokeEnd = 'other';
  // Off the pad (or body) without touching the bat: that is how the ball ended, even if it then ran on.
  const padded = play.events.find((e) => (e.type === 'pad' || e.type === 'body') && !struckFirst(play.events, e.t));
  if (padded && (padded.type === 'pad' || padded.type === 'body')) end = padded.type;
  else if (last) {
    switch (last.type) {
      case 'boundary':
        end = last.six ? 'boundary6' : 'boundary4';
        break;
      case 'stopped':
        end = 'stopped';
        break;
      case 'stumps':
        end = 'bowled';
        break;
      case 'pad':
        end = 'pad';
        break;
      case 'body':
        end = 'body';
        break;
      case 'passedBatter':
        end = 'passed';
        break;
      default:
        end = 'other';
    }
  }
  const struck = c !== undefined && c.kind !== 'miss' && c.kind !== 'leave';
  return {
    kind: c?.kind ?? 'none',
    ...(c?.edge ? { edge: c.edge } : {}),
    quality: c?.quality ?? 0,
    exitSpeed: struck ? c.exitSpeed : 0,
    directionDeg: struck ? c.directionDeg : 0,
    elevationDeg: struck ? c.elevationDeg : 0,
    carry: fb ? dist(fb.x, fb.z) : struck ? dist(endPos.x, endPos.z) : 0,
    apex: play.apex,
    end,
    distance: dist(endPos.x, endPos.z),
    airborneChance,
  };
}

/** Runs a scenario over `n` seeds. */
export function simulateMany(s: Omit<StrokeScenario, 'seed'>, n: number, seedPrefix = 'm'): StrokeSummary[] {
  return Array.from({ length: n }, (_, i) => simulateStroke({ ...s, seed: `${seedPrefix}${i}` }));
}

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const sd = (xs: readonly number[]): number => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
export const rate = <T>(xs: readonly T[], pred: (x: T) => boolean): number => xs.filter(pred).length / Math.max(1, xs.length);
