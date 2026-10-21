import { FIELD } from '../data/field.ts';
import type { Vec3 } from '../core/vec3.ts';

/**
 * Ball flight and ground contact. P0 scope: gravity, quadratic air drag,
 * bounce with restitution and friction, rolling resistance and coming to
 * rest. Swing, seam and spin forces arrive with the bowling system (P1/P2)
 * and plug into `BallForces`.
 */

export const GRAVITY = 9.81;

export interface SurfaceProperties {
  /** Vertical coefficient of restitution on impact. */
  readonly restitution: number;
  /** Fraction of horizontal speed lost per bounce. */
  readonly bounceFriction: number;
  /** Deceleration while rolling, m/s². */
  readonly rollingResistance: number;
}

export const DEFAULT_PITCH: SurfaceProperties = {
  restitution: 0.55,
  bounceFriction: 0.12,
  rollingResistance: 1.6,
};

export interface BallState {
  position: Vec3;
  velocity: Vec3;
  /** True once the ball has stopped moving on the ground. */
  atRest: boolean;
  bounces: number;
}

export interface BallStepEvents {
  bounced: boolean;
  cameToRest: boolean;
}

/** Air drag constant k in a = -k |v| v (≈ ½ρ·Cd·A / m for a cricket ball). */
export const DRAG_K = (0.5 * 1.225 * 0.45 * Math.PI * FIELD.ballRadius ** 2) / FIELD.ballMass;

/** Below this vertical speed a bounce becomes rolling (stops infinite micro-bounces). */
const MIN_BOUNCE_SPEED = 0.35;
const REST_SPEED = 0.05;
/** Physical sanity cap: nothing in cricket moves a ball faster than ~70 m/s. */
export const MAX_BALL_SPEED = 70;

export const createBall = (position: Vec3, velocity: Vec3): BallState => ({
  position: { ...position },
  velocity: { ...velocity },
  atRest: false,
  bounces: 0,
});

/**
 * Advances the ball by one fixed step using semi-implicit Euler, which is
 * stable for this force model at the step sizes used (≤ 1/120 s).
 * Mutates `ball` in place to avoid allocations in the hot loop.
 */
export function stepBall(
  ball: BallState,
  dt: number,
  surface: SurfaceProperties = DEFAULT_PITCH,
  events: BallStepEvents = { bounced: false, cameToRest: false },
): BallStepEvents {
  events.bounced = false;
  events.cameToRest = false;
  if (ball.atRest) return events;

  const r = FIELD.ballRadius;
  const p = ball.position;
  const v = ball.velocity;
  const onGround = p.y <= r + 1e-6 && Math.abs(v.y) < 1e-6;

  if (onGround) {
    // Rolling: decelerate horizontally, stay on the surface.
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

  // Airborne: gravity + quadratic drag.
  const speed = Math.hypot(v.x, v.y, v.z);
  const drag = DRAG_K * speed;
  v.x -= drag * v.x * dt;
  v.y -= (GRAVITY + drag * v.y) * dt;
  v.z -= drag * v.z * dt;

  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Ground contact. Resolved after integration and the ball is placed back on
  // the surface, so it can never tunnel below ground regardless of speed.
  if (p.y <= r && v.y < 0) {
    p.y = r;
    const impactSpeed = -v.y;
    if (impactSpeed < MIN_BOUNCE_SPEED) {
      v.y = 0;
    } else {
      v.y = impactSpeed * surface.restitution;
      ball.bounces += 1;
      events.bounced = true;
    }
    const keep = 1 - surface.bounceFriction;
    v.x *= keep;
    v.z *= keep;
  }

  clampSpeed(v);
  return events;
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
  surface: SurfaceProperties = DEFAULT_PITCH,
): { seconds: number; bounces: number } {
  let t = 0;
  const events: BallStepEvents = { bounced: false, cameToRest: false };
  while (!ball.atRest && t < maxSeconds) {
    stepBall(ball, dt, surface, events);
    t += dt;
  }
  return { seconds: t, bounces: ball.bounces };
}

export const ballSpeed = (ball: BallState): number => Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
