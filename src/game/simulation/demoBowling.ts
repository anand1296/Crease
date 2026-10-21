import { FixedStepClock } from '../core/fixedStep.ts';
import { Rng } from '../core/rng.ts';
import { type Vec3, copyVec3, vec3 } from '../core/vec3.ts';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type BallState, type BallStepEvents, GRAVITY, createBall, stepBall } from '../physics/ball.ts';

/**
 * P0 attract-mode simulation: an endless stream of seeded deliveries with no
 * batter interaction. It exercises the real physics and the fixed-step clock
 * end to end, and is replaced by the delivery/batting engine in P1.
 */
export interface DemoDelivery {
  readonly index: number;
  readonly speed: number;
  /** Intended bounce point (z) before drag shortens it slightly. */
  readonly targetBounceZ: number;
}

const RELEASE_HEIGHT = 2.2;
const RELEASE_Z = BOWLER_STUMPS_Z + 0.6;
/** Seconds of dead time between deliveries. */
const GAP_SECONDS = 1.2;
const MAX_DELIVERY_SECONDS = 4;

/** Initial velocity that pitches at `bounceZ` (ignoring drag) for a given speed. */
export function launchVelocity(release: Readonly<Vec3>, target: Readonly<Vec3>, speed: number): Vec3 {
  const dz = target.z - release.z;
  const dx = target.x - release.x;
  const horizontal = Math.hypot(dx, dz);
  const t = horizontal / speed;
  const vy = (target.y - release.y + 0.5 * GRAVITY * t * t) / t;
  return vec3((dx / horizontal) * speed, vy, (dz / horizontal) * speed);
}

export class DemoBowlingSim {
  readonly clock = new FixedStepClock();
  readonly ball: BallState;
  /** Ball position before the latest step, for render interpolation. */
  readonly previous: Vec3 = vec3();
  delivery: DemoDelivery;
  bouncesThisDelivery = 0;
  private readonly rng: Rng;
  private elapsed = 0;
  private gap = 0;
  private count = 0;
  private readonly events: BallStepEvents = { bounced: false, cameToRest: false };

  constructor(seed: string | number) {
    this.rng = new Rng(seed);
    this.ball = createBall(vec3(), vec3());
    this.delivery = this.bowl();
  }

  /** Advances by a frame delta; returns the number of fixed steps taken. */
  advance(frameSeconds: number): number {
    const steps = this.clock.advance(frameSeconds);
    for (let i = 0; i < steps; i++) this.step(this.clock.stepSeconds);
    return steps;
  }

  step(dt: number): void {
    copyVec3(this.previous, this.ball.position);
    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap <= 0) this.delivery = this.bowl();
      return;
    }
    stepBall(this.ball, dt, undefined, this.events);
    if (this.events.bounced) this.bouncesThisDelivery += 1;
    this.elapsed += dt;
    const finished =
      this.ball.atRest || this.ball.position.z > STRIKER_STUMPS_Z + 3 || this.elapsed > MAX_DELIVERY_SECONDS;
    if (finished) this.gap = GAP_SECONDS;
  }

  private bowl(): DemoDelivery {
    const rng = this.rng.fork(this.count);
    const speed = rng.range(28, 40);
    const targetBounceZ = rng.range(STRIKER_STUMPS_Z - 9, STRIKER_STUMPS_Z - 2);
    const release = vec3(rng.range(-0.25, 0.25), RELEASE_HEIGHT, RELEASE_Z);
    const target = vec3(rng.range(-0.3, 0.4), FIELD.ballRadius, targetBounceZ);
    const v = launchVelocity(release, target, speed);
    copyVec3(this.ball.position, release);
    copyVec3(this.ball.velocity, v);
    copyVec3(this.previous, release);
    this.ball.atRest = false;
    this.ball.bounces = 0;
    this.bouncesThisDelivery = 0;
    this.elapsed = 0;
    this.gap = 0;
    const delivery = { index: this.count, speed, targetBounceZ };
    this.count += 1;
    return delivery;
  }
}
