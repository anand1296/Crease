import { describe, expect, it } from 'vitest';
import { FIELD } from '../data/field.ts';
import { isFiniteVec3 } from '../core/vec3.ts';
import { PITCHES, groundFor } from '../data/pitches.ts';
import {
  type BallMovement,
  type BallStepEvents,
  DEFAULT_GROUND,
  DEFAULT_PITCH,
  GRAVITY,
  type GroundModel,
  MAX_BALL_SPEED,
  NO_MOVEMENT,
  ballSpeed,
  createBall,
  newStepEvents,
  simulateUntilRest,
  stepBall,
} from './ball.ts';

const DT = 1 / 240;
const r = FIELD.ballRadius;

describe('ball flight', () => {
  it('falls under gravity close to the analytic result over short times', () => {
    const ball = createBall({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    const steps = Math.round(0.5 / DT);
    for (let i = 0; i < steps; i++) stepBall(ball, DT);
    const analytic = 10 - 0.5 * GRAVITY * 0.5 ** 2;
    expect(ball.position.y).toBeCloseTo(analytic, 1);
  });

  it('loses speed to drag on a long flight', () => {
    const ball = createBall({ x: 0, y: 1, z: 0 }, { x: 0, y: 15, z: 30 });
    const start = ballSpeed(ball);
    for (let i = 0; i < 120; i++) stepBall(ball, DT);
    // Without drag, horizontal speed would be unchanged.
    expect(ball.velocity.z).toBeLessThan(30);
    expect(ball.velocity.z).toBeGreaterThan(25);
    expect(ballSpeed(ball)).toBeLessThan(start);
  });

  it('gives the same trajectory for the same inputs', () => {
    const run = () => {
      const ball = createBall({ x: 0.1, y: 2.2, z: -9 }, { x: 0.3, y: -1, z: 38 });
      simulateUntilRest(ball, DT, 20);
      return ball.position;
    };
    expect(run()).toEqual(run());
  });
});

describe('ground contact', () => {
  it('bounces, losing energy on each bounce', () => {
    const ball = createBall({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 });
    const events: BallStepEvents = newStepEvents();
    const apexAfterBounce: number[] = [];
    let rising = false;
    let maxSinceBounce = 0;
    for (let i = 0; i < 240 * 6; i++) {
      stepBall(ball, DT, undefined, events);
      if (events.bounced) {
        if (rising) apexAfterBounce.push(maxSinceBounce);
        rising = true;
        maxSinceBounce = 0;
      }
      maxSinceBounce = Math.max(maxSinceBounce, ball.position.y);
    }
    expect(apexAfterBounce.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < apexAfterBounce.length; i++) {
      expect(apexAfterBounce[i]).toBeLessThan(apexAfterBounce[i - 1] ?? Infinity);
    }
  });

  it('never tunnels below the ground, even when very fast', () => {
    const ball = createBall({ x: 0, y: 0.5, z: 0 }, { x: 0, y: -60, z: 10 });
    for (let i = 0; i < 2000; i++) {
      stepBall(ball, DT);
      expect(ball.position.y).toBeGreaterThanOrEqual(r - 1e-9);
    }
  });

  it('settles to rest in finite time instead of bouncing forever', () => {
    const ball = createBall({ x: 0, y: 1, z: 0 }, { x: 0, y: 5, z: 12 });
    const { seconds, bounces } = simulateUntilRest(ball, DT, 60);
    expect(ball.atRest).toBe(true);
    expect(seconds).toBeLessThan(30);
    expect(bounces).toBeLessThan(30);
    expect(ball.position.y).toBeCloseTo(r, 6);
  });

  it('a delivery-like ball bounces once on a good length then carries on', () => {
    // Released ~2.2 m high at the bowler's end, 36 m/s (~130 km/h), angled down.
    const ball = createBall({ x: 0, y: 2.2, z: -9.5 }, { x: 0, y: -2.6, z: 36 });
    const events: BallStepEvents = newStepEvents();
    let bounceZ: number | undefined;
    for (let i = 0; i < 240 && bounceZ === undefined; i++) {
      stepBall(ball, DT, undefined, events);
      if (events.bounced) bounceZ = events.bounceZ;
    }
    expect(bounceZ).toBeDefined();
    // Pitches somewhere between the popping creases.
    expect(bounceZ).toBeGreaterThan(-8);
    expect(bounceZ).toBeLessThan(10);
    expect(ball.velocity.y).toBeGreaterThan(0);
  });
});

/** Runs a ball to its first bounce and then for `after` seconds; returns positions. */
function flight(movement: Partial<BallMovement>, ground?: GroundModel, after = 0.3) {
  const ball = createBall({ x: 0, y: 2.2, z: -9.5 }, { x: 0, y: -2.6, z: 36 }, { ...NO_MOVEMENT, ...movement });
  const events = newStepEvents();
  let bounce: { x: number; z: number; vx: number; vy: number } | undefined;
  let t = 0;
  while (t < 2) {
    stepBall(ball, DT, ground, events);
    t += DT;
    if (events.bounced && !bounce) {
      bounce = { x: events.bounceX, z: events.bounceZ, vx: ball.velocity.x, vy: ball.velocity.y };
      t = 2 - after;
    }
  }
  return { bounce, end: { ...ball.position } };
}

describe('delivery movement', () => {
  it('swing moves the ball sideways in the air, in the direction of the force', () => {
    const none = flight({});
    const out = flight({ swingAccel: 4 });
    const inn = flight({ swingAccel: -4 });
    expect(out.bounce?.x ?? 0).toBeGreaterThan((none.bounce?.x ?? 0) + 0.15);
    expect(inn.bounce?.x ?? 0).toBeLessThan((none.bounce?.x ?? 0) - 0.15);
  });

  it('swing stops after the ball pitches', () => {
    const out = flight({ swingAccel: 4 });
    expect(out.bounce?.vx ?? 0).toBeGreaterThan(0);
    // After the bounce no further lateral acceleration: drift stays roughly linear.
    expect(out.end.x - (out.bounce?.x ?? 0)).toBeLessThan((out.bounce?.vx ?? 0) * 0.3 + 0.02);
  });

  it('seam movement changes direction only at the bounce and scales with the pitch', () => {
    const seamy = flight({ seamDeltaV: 1.2 });
    const dead: GroundModel = { pitch: { ...DEFAULT_PITCH, seam: 0 }, outfield: DEFAULT_GROUND.outfield };
    const flatSeam = flight({ seamDeltaV: 1.2 }, dead);
    expect(seamy.bounce?.x ?? 1).toBeCloseTo(0, 3);
    expect(seamy.bounce?.vx ?? 0).toBeGreaterThan(1);
    expect(flatSeam.bounce?.vx ?? 1).toBeCloseTo(0, 3);
  });

  it('side spin drifts one way in the air and turns the other way off the pitch, more on a dry pitch', () => {
    const leg = flight({ spinSide: 25 });
    expect(leg.bounce?.x ?? 0).toBeLessThan(-0.01);
    expect(leg.bounce?.vx ?? 0).toBeGreaterThan(0.8);
    const dry = flight({ spinSide: 25 }, groundFor(PITCHES.dry));
    expect(dry.bounce?.vx ?? 0).toBeGreaterThan(leg.bounce?.vx ?? 0);
  });

  it('topspin bounces higher than backspin from the same release', () => {
    const top = flight({ spinTop: 25 });
    const back = flight({ spinTop: -25 });
    expect(top.bounce?.vy ?? 0).toBeGreaterThan((back.bounce?.vy ?? 0) * 1.2);
  });

  it('the outfield is deader than the pitch', () => {
    const drop = (x: number) => {
      const ball = createBall({ x, y: 2, z: 0 }, { x: 0, y: 0, z: 0 });
      const events = newStepEvents();
      for (let i = 0; i < 400 && !events.bounced; i++) stepBall(ball, DT, undefined, events);
      return ball.velocity.y;
    };
    expect(drop(30)).toBeLessThan(drop(0));
  });
});

describe('numerical safety', () => {
  it('clamps impossible speeds and stays finite', () => {
    const ball = createBall({ x: 0, y: 1, z: 0 }, { x: 500, y: 300, z: 900 });
    for (let i = 0; i < 2000; i++) {
      stepBall(ball, DT);
      expect(isFiniteVec3(ball.position)).toBe(true);
      expect(ballSpeed(ball)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-6);
    }
  });
});
