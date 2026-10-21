import { type Vec3, vec3 } from '../core/vec3.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import {
  type BallMovement,
  DEFAULT_GROUND,
  GRAVITY,
  type GroundModel,
  createBall,
  newStepEvents,
  stepBall,
} from '../physics/ball.ts';

export const SOLVER_DT = 1 / 240;

/** Initial velocity that reaches `target` (ignoring drag and movement) at a given horizontal speed. */
export function launchVelocity(release: Readonly<Vec3>, target: Readonly<Vec3>, horizontalSpeed: number): Vec3 {
  const dz = target.z - release.z;
  const dx = target.x - release.x;
  const horizontal = Math.hypot(dx, dz);
  const t = horizontal / horizontalSpeed;
  const vy = (target.y - release.y + 0.5 * GRAVITY * t * t) / t;
  return vec3((dx / horizontal) * horizontalSpeed, vy, (dz / horizontal) * horizontalSpeed);
}

export interface FlightSample {
  /** Where the ball first touched the ground, if it did before reaching the stumps. */
  readonly pitch?: { readonly x: number; readonly z: number; readonly t: number };
  /** Ball position and time when it reaches the plane of the striker's stumps. */
  readonly atStumps?: { readonly x: number; readonly y: number; readonly t: number };
}

/** Simulates a delivery until it passes the striker's stumps (or 3 s). Pure: does not mutate inputs. */
export function sampleFlight(
  release: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  movement: Readonly<BallMovement>,
  ground: GroundModel = DEFAULT_GROUND,
): FlightSample {
  const ball = createBall(release, velocity, movement);
  const events = newStepEvents();
  let t = 0;
  let pitch: FlightSample['pitch'];
  let prevZ = ball.position.z;
  let prevX = ball.position.x;
  let prevY = ball.position.y;
  while (t < 3 && !ball.atRest) {
    stepBall(ball, SOLVER_DT, ground, events);
    t += SOLVER_DT;
    if (events.bounced && !pitch) pitch = { x: events.bounceX, z: events.bounceZ, t };
    if (ball.position.z >= STRIKER_STUMPS_Z) {
      // Interpolate the crossing of the stumps plane.
      const f = (STRIKER_STUMPS_Z - prevZ) / (ball.position.z - prevZ);
      const atStumps = {
        x: prevX + (ball.position.x - prevX) * f,
        y: prevY + (ball.position.y - prevY) * f,
        t: t - SOLVER_DT * (1 - f),
      };
      return pitch ? { pitch, atStumps } : { atStumps };
    }
    prevZ = ball.position.z;
    prevX = ball.position.x;
    prevY = ball.position.y;
  }
  return pitch ? { pitch } : {};
}

export interface SolveTarget {
  /** Pitching point, or for a full toss the point at the stumps plane. */
  readonly x: number;
  readonly z: number;
  /** Full toss: height at the stumps plane instead of pitching. */
  readonly fullTossHeight?: number;
}

/**
 * Shooting-method solver: finds the launch velocity that makes the ball,
 * with the given movement, actually pitch at `target` (drag and swing
 * included). Converges in a handful of cheap simulations.
 */
export function solveLaunch(
  release: Readonly<Vec3>,
  target: SolveTarget,
  horizontalSpeed: number,
  movement: Readonly<BallMovement>,
  ground: GroundModel = DEFAULT_GROUND,
): Vec3 {
  const fullToss = target.fullTossHeight !== undefined;
  const goal = vec3(target.x, fullToss ? (target.fullTossHeight ?? 0) : FIELD.ballRadius, fullToss ? STRIKER_STUMPS_Z : target.z);
  const aim = { ...goal };
  let velocity = launchVelocity(release, aim, horizontalSpeed);
  for (let i = 0; i < 8; i++) {
    const sample = sampleFlight(release, velocity, movement, ground);
    let ex: number;
    let ey = 0;
    let ez = 0;
    if (fullToss) {
      if (!sample.atStumps) break;
      ex = sample.atStumps.x - goal.x;
      ey = sample.atStumps.y - goal.y;
    } else {
      if (!sample.pitch) break;
      ex = sample.pitch.x - goal.x;
      ez = sample.pitch.z - goal.z;
    }
    if (Math.abs(ex) < 0.005 && Math.abs(ey) < 0.005 && Math.abs(ez) < 0.01) break;
    aim.x -= ex;
    aim.y -= ey;
    aim.z -= ez;
    velocity = launchVelocity(release, aim, horizontalSpeed);
  }
  return velocity;
}
