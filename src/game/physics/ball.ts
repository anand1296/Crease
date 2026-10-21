import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import type { Vec3 } from '../core/vec3.ts';

/**
 * Ball flight and ground contact.
 *
 * Forces in flight: gravity, quadratic air drag, swing (lateral force before
 * the first bounce) and spin (sideways drift and topspin dip, both from the
 * Magnus effect). At the first bounce on the pitch, seam movement and spin
 * turn change the lateral velocity, and topspin/backspin change how the
 * ball comes off the surface. Those delivery effects are spent after the
 * first bounce, and are cleared entirely when the bat hits the ball.
 *
 * Integration is semi-implicit Euler at a fixed step (see FixedStepClock).
 */

export const GRAVITY = 9.81;

export interface SurfaceProperties {
  /** Vertical coefficient of restitution on impact. */
  readonly restitution: number;
  /** Fraction of horizontal speed lost per bounce (higher = slower surface). */
  readonly bounceFriction: number;
  /** Deceleration while rolling, m/s². */
  readonly rollingResistance: number;
  /** Multiplier on spin turn (dry, dusty pitches grip more). */
  readonly grip: number;
  /** Multiplier on seam movement (green pitches seam more). */
  readonly seam: number;
}

export interface GroundModel {
  readonly pitch: SurfaceProperties;
  readonly outfield: SurfaceProperties;
}

export const DEFAULT_PITCH: SurfaceProperties = {
  restitution: 0.55,
  bounceFriction: 0.12,
  rollingResistance: 1.6,
  grip: 1,
  seam: 1,
};

export const DEFAULT_OUTFIELD: SurfaceProperties = {
  restitution: 0.35,
  bounceFriction: 0.12,
  rollingResistance: 2.6,
  grip: 0,
  seam: 0,
};

export const DEFAULT_GROUND: GroundModel = { pitch: DEFAULT_PITCH, outfield: DEFAULT_OUTFIELD };

/** Delivery movement carried by the ball until its first bounce (or bat contact). */
export interface BallMovement {
  /** Lateral (x) acceleration in flight before the first bounce, m/s². */
  swingAccel: number;
  /** Lateral velocity change at the first bounce from the seam, m/s (before pitch multiplier). */
  seamDeltaV: number;
  /** Side spin, rev/s. Positive turns the ball towards +x off the pitch. */
  spinSide: number;
  /** Top spin, rev/s. Positive = topspin (dips, bounces higher); negative = backspin. */
  spinTop: number;
  /** Per-delivery bounce variation (1 = true bounce). */
  bounceFactor: number;
}

export const NO_MOVEMENT: Readonly<BallMovement> = {
  swingAccel: 0,
  seamDeltaV: 0,
  spinSide: 0,
  spinTop: 0,
  bounceFactor: 1,
};

export interface BallState {
  position: Vec3;
  velocity: Vec3;
  movement: BallMovement;
  /** True once the ball has stopped moving on the ground. */
  atRest: boolean;
  bounces: number;
}

export interface BallStepEvents {
  bounced: boolean;
  cameToRest: boolean;
  /** Exact ground contact point of the bounce in this step (valid when `bounced`). */
  bounceX: number;
  bounceZ: number;
}

export const newStepEvents = (): BallStepEvents => ({ bounced: false, cameToRest: false, bounceX: 0, bounceZ: 0 });

/** Air drag constant k in a = -k |v| v (≈ ½ρ·Cd·A / m for a cricket ball). */
export const DRAG_K = (0.5 * 1.225 * 0.45 * Math.PI * FIELD.ballRadius ** 2) / FIELD.ballMass;

/** Spin model constants (per rev/s), tuned so 25 rev/s gives realistic drift, dip and turn. */
export const SPIN = {
  /** Sideways drift in the air, opposite to the direction of turn. */
  driftPerRps: 0.024,
  /** Extra downward acceleration from topspin. */
  dipPerRps: 0.05,
  /** Lateral velocity change at the bounce. */
  turnPerRps: 0.048,
  /** Fractional change in restitution per rev/s of topspin. */
  bouncePerRps: 0.006,
  /** Fractional change in retained pace per rev/s of topspin. */
  pacePerRps: 0.002,
} as const;

/** Below this vertical speed a bounce becomes rolling (stops infinite micro-bounces). */
const MIN_BOUNCE_SPEED = 0.35;
const REST_SPEED = 0.05;
/** Physical sanity cap: nothing in cricket moves a ball faster than ~70 m/s. */
export const MAX_BALL_SPEED = 70;

/** The pitch is 3.05 m wide and extends a little past each set of stumps. */
export function isOnPitch(p: Readonly<Vec3>): boolean {
  return Math.abs(p.x) <= FIELD.pitchWidth / 2 && Math.abs(p.z) <= STRIKER_STUMPS_Z + 1.5;
}

export const createBall = (position: Vec3, velocity: Vec3, movement: Readonly<BallMovement> = NO_MOVEMENT): BallState => ({
  position: { ...position },
  velocity: { ...velocity },
  movement: { ...movement },
  atRest: false,
  bounces: 0,
});

/** Removes all delivery movement, e.g. after the bat has struck the ball. */
export function clearMovement(ball: BallState): void {
  Object.assign(ball.movement, NO_MOVEMENT);
}

/**
 * Advances the ball by one fixed step. Mutates `ball` and `events` in place
 * to avoid allocations in the hot loop.
 */
export function stepBall(
  ball: BallState,
  dt: number,
  ground: GroundModel = DEFAULT_GROUND,
  events: BallStepEvents = newStepEvents(),
): BallStepEvents {
  events.bounced = false;
  events.cameToRest = false;
  if (ball.atRest) return events;

  const r = FIELD.ballRadius;
  const p = ball.position;
  const v = ball.velocity;
  const m = ball.movement;
  const onGround = p.y <= r + 1e-6 && Math.abs(v.y) < 1e-6;

  if (onGround) {
    const surface = isOnPitch(p) ? ground.pitch : ground.outfield;
    const speed = Math.hypot(v.x, v.z);
    const drop = surface.rollingResistance * dt;
    if (speed <= drop || speed < REST_SPEED) {
      v.x = 0;
      v.z = 0;
      ball.atRest = true;
      events.cameToRest = true;
    } else {
      const scale = (speed - drop) / speed;
      v.x *= scale;
      v.z *= scale;
    }
    p.x += v.x * dt;
    p.z += v.z * dt;
    p.y = r;
    return events;
  }

  // Airborne: gravity, drag, and (before the first bounce) swing and spin.
  const speed = Math.hypot(v.x, v.y, v.z);
  const drag = DRAG_K * speed;
  let ax = -drag * v.x;
  let ay = -GRAVITY - drag * v.y;
  const az = -drag * v.z;
  if (ball.bounces === 0) {
    ax += m.swingAccel - SPIN.driftPerRps * m.spinSide;
    ay -= SPIN.dipPerRps * m.spinTop;
  }
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;

  const y0 = p.y;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Ground contact. The exact moment of contact within the step is found by
  // interpolation, the bounce is applied there, and the rest of the step
  // continues with the new velocity. The ball is never left below ground, so
  // it cannot tunnel regardless of speed, and bounce points are exact rather
  // than quantised to the step length (≈17 cm at 40 m/s).
  if (p.y <= r && v.y < 0) {
    const f = y0 > r ? Math.min(1, Math.max(0, (y0 - r) / (y0 - p.y))) : 0;
    const remaining = (1 - f) * dt;
    p.x -= v.x * remaining;
    p.z -= v.z * remaining;
    p.y = r;
    events.bounceX = p.x;
    events.bounceZ = p.z;
    resolveBounce(ball, isOnPitch(p) ? ground.pitch : ground.outfield, events);
    p.x += v.x * remaining;
    p.z += v.z * remaining;
    p.y = r + Math.max(0, v.y) * remaining;
  }

  clampSpeed(v);
  return events;
}

function resolveBounce(ball: BallState, surface: SurfaceProperties, events: BallStepEvents): void {
  const v = ball.velocity;
  const m = ball.movement;
  const impactSpeed = -v.y;
  const firstBounce = ball.bounces === 0;

  let restitution = surface.restitution;
  let keep = 1 - surface.bounceFriction;
  if (firstBounce) {
    restitution *= m.bounceFactor * (1 + SPIN.bouncePerRps * m.spinTop);
    keep = Math.min(0.98, keep + SPIN.pacePerRps * m.spinTop);
  }

  if (impactSpeed < MIN_BOUNCE_SPEED) {
    v.y = 0;
  } else {
    v.y = impactSpeed * restitution;
    ball.bounces += 1;
    events.bounced = true;
  }
  v.x *= keep;
  v.z *= keep;

  if (firstBounce) {
    v.x += m.seamDeltaV * surface.seam + SPIN.turnPerRps * m.spinSide * surface.grip;
    // Delivery movement is spent once the ball has pitched.
    m.swingAccel = 0;
    m.seamDeltaV = 0;
    m.spinSide = 0;
    m.spinTop = 0;
  }
}

function clampSpeed(v: Vec3): void {
  const s = Math.hypot(v.x, v.y, v.z);
  if (s > MAX_BALL_SPEED) {
    const k = MAX_BALL_SPEED / s;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
}

/** Convenience for tests and AI look-ahead: simulates until rest or `maxSeconds`. */
export function simulateUntilRest(
  ball: BallState,
  dt: number,
  maxSeconds: number,
  ground: GroundModel = DEFAULT_GROUND,
): { seconds: number; bounces: number } {
  let t = 0;
  const events = newStepEvents();
  while (!ball.atRest && t < maxSeconds) {
    stepBall(ball, dt, ground, events);
    t += dt;
  }
  return { seconds: t, bounces: ball.bounces };
}

export const ballSpeed = (ball: BallState): number => Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);

export const cloneBall = (ball: Readonly<BallState>): BallState => ({
  position: { ...ball.position },
  velocity: { ...ball.velocity },
  movement: { ...ball.movement },
  atRest: ball.atRest,
  bounces: ball.bounces,
});
