import type { Rng } from '../core/rng.ts';
import { type Vec3, copyVec3, vec3 } from '../core/vec3.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type Box, batterBoxes, contactPlaneZ } from '../batting/body.ts';
import { type ContactResult, resolveContact } from '../batting/contact.ts';
import { SHOTS, type ShotAttempt } from '../batting/shots.ts';
import type { ExecutedDelivery } from '../bowling/execute.ts';
import type { Player } from '../model/player.ts';
import {
  type BallState,
  type GroundModel,
  clearMovement,
  cloneBall,
  createBall,
  newStepEvents,
  stepBall,
} from '../physics/ball.ts';
import { offSideSign } from '../model/player.ts';

/**
 * One delivery, from release until the ball is dead (or handed to fielding).
 * The same class drives the live game frame by frame and runs headless in
 * tests and AI look-ahead, so there is a single implementation of the rules
 * of contact.
 */
export type BallEvent =
  | { readonly type: 'bounce'; readonly t: number; readonly x: number; readonly z: number; readonly struck: boolean }
  | { readonly type: 'contact'; readonly t: number; readonly result: ContactResult; readonly position: Vec3 }
  | { readonly type: 'beaten'; readonly t: number; readonly result: ContactResult }
  | { readonly type: 'pad' | 'body'; readonly t: number; readonly position: Vec3; readonly velocity: Vec3; readonly lbw: LbwVerdict }
  | { readonly type: 'stumps'; readonly t: number; readonly afterContact: boolean }
  | { readonly type: 'passedBatter'; readonly t: number; readonly position: Vec3 }
  | { readonly type: 'boundary'; readonly t: number; readonly six: boolean; readonly position: Vec3 }
  | { readonly type: 'stopped'; readonly t: number; readonly position: Vec3 };

export type BallPhase = 'delivery' | 'struck' | 'dead';

/** The umpire's leg-before-wicket decision (Law 36, without umpire's-call margins). */
export interface LbwVerdict {
  readonly out: boolean;
  readonly reason: 'out' | 'pitched outside leg' | 'impact outside line' | 'missing stumps' | 'going over';
}

export interface BallInPlayOptions {
  readonly delivery: ExecutedDelivery;
  readonly striker: Player;
  readonly ground: GroundModel;
  readonly rng: Rng;
}

const STUMP_HALF_WIDTH = FIELD.wicketWidth / 2 + FIELD.ballRadius;
const STUMP_TOP = FIELD.stumpHeight + FIELD.ballRadius;
/** Once struck, the ball is followed until it stops, crosses the boundary or this many seconds pass. */
const MAX_STRUCK_SECONDS = 14;

interface Stroke {
  readonly attempt: ShotAttempt;
  readonly pressTime: number;
  /** When the bat reaches the contact point. */
  readonly batTime: number;
  readonly planeZ: number;
  /** Where the batter set the bat (world x, y at the contact plane), from what they could see when committing. */
  readonly expected: { readonly x: number; readonly y: number };
  /** Whether the ball had already pitched when the batter committed. */
  readonly sawBounce: boolean;
  arrival?: number;
  resolved: boolean;
}

export class BallInPlay {
  readonly ball: BallState;
  readonly previous: Vec3;
  readonly events: BallEvent[] = [];
  readonly delivery: ExecutedDelivery;
  time = 0;
  phase: BallPhase = 'delivery';
  contact?: ContactResult;
  /** Struck ball: first bounce after contact, apex height. */
  firstBounceAfterContact?: { x: number; z: number; t: number };
  apex = 0;
  private stroke?: Stroke;
  private boxes: Box[];
  private readonly opts: BallInPlayOptions;
  private readonly stepEvents = newStepEvents();
  private struckAt = 0;
  private edged = false;
  private bounceTime?: number;

  constructor(opts: BallInPlayOptions) {
    this.opts = opts;
    this.delivery = opts.delivery;
    this.ball = createBall(opts.delivery.release, opts.delivery.velocity, opts.delivery.movement);
    this.previous = { ...this.ball.position };
    this.boxes = batterBoxes(opts.striker.battingHand, null, 0, opts.striker.batting.footwork);
  }

  /** Whether a stroke can still be committed to. */
  get canPlayShot(): boolean {
    return this.phase === 'delivery' && !this.stroke;
  }

  get shot(): ShotAttempt | undefined {
    return this.stroke?.attempt;
  }

  /** Stroke timing and placement, for animating the bat in sync with the simulation. */
  get strokeInfo():
    | { readonly attempt: ShotAttempt; readonly pressTime: number; readonly batTime: number; readonly planeZ: number; readonly expected: { readonly x: number; readonly y: number } }
    | undefined {
    const s = this.stroke;
    return s ? { attempt: s.attempt, pressTime: s.pressTime, batTime: s.batTime, planeZ: s.planeZ, expected: s.expected } : undefined;
  }

  /** Commits to a stroke now (or at `atTime`). One stroke per delivery. */
  playShot(attempt: ShotAttempt, atTime: number = this.time): boolean {
    if (!this.canPlayShot) return false;
    const def = SHOTS[attempt.shot];
    const pitchZ = this.delivery.actual.pitch?.z;
    const planeZ = contactPlaneZ(attempt, this.opts.striker.batting.footwork, pitchZ);
    const expected = this.perceivedAt(planeZ);
    this.stroke = {
      attempt,
      pressTime: atTime,
      batTime: atTime + def.swingTime,
      planeZ,
      expected,
      sawBounce: this.ball.bounces > 0,
      resolved: false,
    };
    // Pads move with the footwork; their line is fixed when the stroke is chosen.
    const line = predictArrival(this.delivery, planeZ, this.opts.ground)?.x ?? this.ball.position.x;
    this.boxes = batterBoxes(this.opts.striker.battingHand, attempt, line, this.opts.striker.batting.footwork, pitchZ);
    return true;
  }

  /**
   * Where the batter expects the ball at plane z, judged from what is visible
   * now: the flight so far, swing and spin only as well as their technique
   * reads them, and a true bounce. Seam movement cannot be anticipated; a
   * wrong'un is read as the stock ball unless the batter picks it.
   */
  private perceivedAt(z: number): { x: number; y: number } {
    const ball = cloneBall(this.ball);
    if (ball.bounces === 0) {
      const technique = this.opts.striker.batting.technique / 100;
      // Swing is visible as the ball curves; spin has to be read from the hand and the air.
      const swingRead = 0.75 + 0.25 * technique;
      const read = 0.45 + 0.5 * technique;
      const wrongUn = this.delivery.type.id === 'doosra' || this.delivery.type.id === 'googly';
      const picked = !wrongUn || this.opts.rng.fork('read').chance(0.2 + 0.6 * technique);
      const m = ball.movement;
      m.swingAccel *= swingRead;
      m.seamDeltaV = 0;
      m.spinSide = (picked ? m.spinSide : -m.spinSide) * read;
      m.bounceFactor = 1;
    }
    const ev = newStepEvents();
    const dt = 1 / 240;
    let prev = { ...ball.position };
    for (let t = 0; t < 3; t += dt) {
      stepBall(ball, dt, this.opts.ground, ev);
      if (prev.z < z && ball.position.z >= z) {
        const f = (z - prev.z) / (ball.position.z - prev.z);
        return { x: prev.x + (ball.position.x - prev.x) * f, y: prev.y + (ball.position.y - prev.y) * f };
      }
      prev = { ...ball.position };
    }
    return { x: ball.position.x, y: ball.position.y };
  }

  get bodyBoxes(): readonly Box[] {
    return this.boxes;
  }

  /** Advances one fixed step. Returns the events raised during the step. */
  step(dt: number): BallEvent[] {
    const raised: BallEvent[] = [];
    if (this.phase === 'dead') return raised;
    const b = this.ball;
    copyVec3(this.previous, b.position);
    const t0 = this.time;
    stepBall(b, dt, this.opts.ground, this.stepEvents);
    this.time += dt;

    if (this.stepEvents.bounced && this.phase === 'delivery' && this.bounceTime === undefined) this.bounceTime = this.time;
    if (this.stepEvents.bounced) {
      const ev: BallEvent = { type: 'bounce', t: this.time, x: this.stepEvents.bounceX, z: this.stepEvents.bounceZ, struck: this.phase === 'struck' };
      raised.push(ev);
      if (this.phase === 'struck' && !this.firstBounceAfterContact) {
        this.firstBounceAfterContact = { x: ev.x, z: ev.z, t: this.time };
      }
    }

    if (this.phase === 'delivery') {
      this.stepDelivery(t0, dt, raised);
    } else if (this.phase === 'struck') {
      this.stepStruck(raised);
    }
    for (const ev of raised) this.events.push(ev);
    return raised;
  }

  /** Runs headless until the ball is dead or `maxSeconds` pass. */
  runToEnd(dt = 1 / 240, maxSeconds = 20): void {
    while (this.phase !== 'dead' && this.time < maxSeconds) this.step(dt);
  }

  private stepDelivery(t0: number, dt: number, raised: BallEvent[]): void {
    const b = this.ball;
    const p0 = this.previous;
    const p1 = b.position;
    const s = this.stroke;

    // --- Bat ---
    if (s && !s.resolved) {
      if (s.arrival === undefined && p0.z < s.planeZ && p1.z >= s.planeZ) {
        s.arrival = t0 + dt * ((s.planeZ - p0.z) / (p1.z - p0.z));
      }
      if (s.arrival !== undefined) {
        const early = s.batTime <= s.arrival;
        if (early || this.time >= s.batTime) {
          // Early: contact as the ball reaches the plane. Late: wherever the ball is when the bat arrives.
          const f = early ? (s.planeZ - p0.z) / (p1.z - p0.z) : 1;
          const at = vec3(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0.z + (p1.z - p0.z) * f);
          s.resolved = true;
          // Once the ball pitches the batter can correct the bat — if there is time before it arrives.
          const technique = this.opts.striker.batting.technique / 100;
          const sinceBounce = s.sawBounce || this.bounceTime === undefined ? 1 : this.time - this.bounceTime;
          const adjust = Math.min(0.9, Math.max(0, (sinceBounce - 0.1) / 0.25)) * (0.6 + 0.4 * technique);
          const off = offSideSign(this.opts.striker.battingHand);
          const result = resolveContact({
            attempt: s.attempt,
            batter: this.opts.striker,
            ballPosition: at,
            ballVelocity: b.velocity,
            timingError: s.batTime - s.arrival,
            lineError: (at.x - s.expected.x) * off * (1 - adjust),
            heightError: (at.y - s.expected.y) * (1 - adjust),
            rng: this.opts.rng,
          });
          this.contact = result;
          if (result.kind === 'miss' || result.kind === 'leave') {
            raised.push({ type: 'beaten', t: this.time, result });
          } else {
            copyVec3(b.position, at);
            copyVec3(b.velocity, result.velocity);
            clearMovement(b);
            b.bounces = 0;
            this.phase = 'struck';
            this.struckAt = this.time;
            this.edged = result.kind === 'edge';
            raised.push({ type: 'contact', t: this.time, result, position: { ...at } });
            return;
          }
        }
      }
    }

    // --- Pads and body ---
    const hit = this.hitBox(p0, p1);
    if (hit) {
      const lbw = this.judgeLbw();
      raised.push({ type: hit.part, t: this.time, position: { ...p1 }, velocity: { ...b.velocity }, lbw });
      this.deaden();
      return;
    }

    // --- Stumps / past the batter ---
    if (this.crossedStumps(p0, p1, raised, false)) return;
    if (p1.z > STRIKER_STUMPS_Z + 0.3) {
      raised.push({ type: 'passedBatter', t: this.time, position: { ...p1 } });
      this.phase = 'dead';
    }
  }

  private stepStruck(raised: BallEvent[]): void {
    const b = this.ball;
    const p = b.position;
    this.apex = Math.max(this.apex, p.y);
    // Edges and defensive strokes can still go on to the stumps or pads.
    if (this.edged || b.velocity.z > 0) {
      if (this.crossedStumps(this.previous, p, raised, true)) return;
    }
    const r = Math.hypot(p.x, p.z);
    if (r >= FIELD.boundaryRadius) {
      raised.push({ type: 'boundary', t: this.time, six: !this.firstBounceAfterContact, position: { ...p } });
      this.phase = 'dead';
      return;
    }
    if (b.atRest || this.time - this.struckAt > MAX_STRUCK_SECONDS) {
      raised.push({ type: 'stopped', t: this.time, position: { ...p } });
      this.phase = 'dead';
    }
  }

  /**
   * Law 36, simplified: not out if the ball pitched outside leg stump; not
   * out if it struck the batter outside the line of the stumps (outside off
   * only counts when no stroke was offered); otherwise out if, projected on
   * from the impact, it would have hit the stumps.
   */
  private judgeLbw(): LbwVerdict {
    const off = offSideSign(this.opts.striker.battingHand);
    const half = STUMP_HALF_WIDTH;
    const pitch = this.delivery.actual.pitch && this.bounceTime !== undefined ? this.events.find((e) => e.type === 'bounce') : undefined;
    if (pitch && pitch.type === 'bounce' && pitch.x * off < -half) return { out: false, reason: 'pitched outside leg' };
    const impactLine = this.ball.position.x * off;
    const noStroke = !this.stroke || this.stroke.attempt.shot === 'leave';
    if (impactLine < -half || (impactLine > half && !noStroke)) return { out: false, reason: 'impact outside line' };
    // Project the ball on as if the batter were not there.
    const ghost = cloneBall(this.ball);
    const ev = newStepEvents();
    let prev = { ...ghost.position };
    for (let t = 0; t < 1.5; t += 1 / 240) {
      stepBall(ghost, 1 / 240, this.opts.ground, ev);
      if (prev.z < STRIKER_STUMPS_Z && ghost.position.z >= STRIKER_STUMPS_Z) {
        const f = (STRIKER_STUMPS_Z - prev.z) / (ghost.position.z - prev.z);
        const x = prev.x + (ghost.position.x - prev.x) * f;
        const y = prev.y + (ghost.position.y - prev.y) * f;
        if (y > STUMP_TOP) return { out: false, reason: 'going over' };
        if (Math.abs(x) > half) return { out: false, reason: 'missing stumps' };
        return { out: true, reason: 'out' };
      }
      prev = { ...ghost.position };
    }
    return { out: false, reason: 'missing stumps' };
  }

  private crossedStumps(p0: Readonly<Vec3>, p1: Readonly<Vec3>, raised: BallEvent[], afterContact: boolean): boolean {
    if (!(p0.z < STRIKER_STUMPS_Z && p1.z >= STRIKER_STUMPS_Z)) return false;
    const f = (STRIKER_STUMPS_Z - p0.z) / (p1.z - p0.z);
    const x = p0.x + (p1.x - p0.x) * f;
    const y = p0.y + (p1.y - p0.y) * f;
    if (Math.abs(x) <= STUMP_HALF_WIDTH && y <= STUMP_TOP) {
      raised.push({ type: 'stumps', t: this.time, afterContact });
      this.deaden();
      return true;
    }
    return false;
  }

  private hitBox(p0: Readonly<Vec3>, p1: Readonly<Vec3>): Box | undefined {
    const r = FIELD.ballRadius;
    for (const box of this.boxes) {
      if (segmentHitsBox(p0, p1, box, r)) return box;
    }
    return undefined;
  }

  private deaden(): void {
    this.ball.velocity.x = 0;
    this.ball.velocity.y = 0;
    this.ball.velocity.z = 0;
    this.phase = 'dead';
  }
}

/** Segment vs. box expanded by the ball radius (slab test). */
export function segmentHitsBox(p0: Readonly<Vec3>, p1: Readonly<Vec3>, box: Box, r: number): boolean {
  let tMin = 0;
  let tMax = 1;
  const axes: [number, number, number, number][] = [
    [p0.x, p1.x, box.minX - r, box.maxX + r],
    [p0.y, p1.y, box.minY - r, box.maxY + r],
    [p0.z, p1.z, box.minZ - r, box.maxZ + r],
  ];
  for (const [a, b, lo, hi] of axes) {
    const d = b - a;
    if (Math.abs(d) < 1e-12) {
      if (a < lo || a > hi) return false;
      continue;
    }
    let t1 = (lo - a) / d;
    let t2 = (hi - a) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Where and when the delivery reaches plane `z`, simulating from release
 * with no batter. Used for pad placement and by the AI; the AI adds its own
 * perception error so it is never omniscient.
 */
export function predictArrival(
  delivery: ExecutedDelivery,
  z: number,
  ground?: GroundModel,
): { t: number; x: number; y: number; speed: number } | undefined {
  const ball = createBall(delivery.release, delivery.velocity, delivery.movement);
  const ev = newStepEvents();
  const dt = 1 / 240;
  let t = 0;
  let prev = { ...ball.position };
  while (t < 3) {
    stepBall(ball, dt, ground, ev);
    t += dt;
    if (prev.z < z && ball.position.z >= z) {
      const f = (z - prev.z) / (ball.position.z - prev.z);
      return {
        t: t - dt * (1 - f),
        x: prev.x + (ball.position.x - prev.x) * f,
        y: prev.y + (ball.position.y - prev.y) * f,
        speed: Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z),
      };
    }
    prev = { ...ball.position };
  }
  return undefined;
}
