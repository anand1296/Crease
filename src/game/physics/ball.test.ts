import { describe, expect, it } from 'vitest';
import { FIELD } from '../data/field.ts';
import { isFiniteVec3 } from '../core/vec3.ts';
import {
  type BallStepEvents,
  GRAVITY,
  MAX_BALL_SPEED,
  ballSpeed,
  createBall,
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
    const events: BallStepEvents = { bounced: false, cameToRest: false };
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
    const events: BallStepEvents = { bounced: false, cameToRest: false };
    let bounceZ: number | undefined;
    for (let i = 0; i < 240 && bounceZ === undefined; i++) {
      stepBall(ball, DT, undefined, events);
      if (events.bounced) bounceZ = ball.position.z;
    }
    expect(bounceZ).toBeDefined();
    // Pitches somewhere between the popping creases.
    expect(bounceZ).toBeGreaterThan(-8);
    expect(bounceZ).toBeLessThan(10);
    expect(ball.velocity.y).toBeGreaterThan(0);
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
