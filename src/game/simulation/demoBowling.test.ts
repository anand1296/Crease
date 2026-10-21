import { describe, expect, it } from 'vitest';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { DemoBowlingSim, launchVelocity } from './demoBowling.ts';

describe('launchVelocity', () => {
  it('produces the requested speed horizontally', () => {
    const v = launchVelocity({ x: 0, y: 2.2, z: -9.5 }, { x: 0.2, y: FIELD.ballRadius, z: 4 }, 35);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(35, 6);
    expect(v.y).toBeLessThan(0);
  });
});

describe('DemoBowlingSim', () => {
  it('is reproducible from its seed', () => {
    const run = () => {
      const sim = new DemoBowlingSim('demo');
      for (let i = 0; i < 600; i++) sim.advance(1 / 60);
      return { pos: { ...sim.ball.position }, index: sim.delivery.index };
    };
    expect(run()).toEqual(run());
  });

  it('runs a sequence of deliveries that pitch on the pitch and travel towards the striker', () => {
    const sim = new DemoBowlingSim('sequence');
    const firstBounceZ = new Map<number, number>();
    let lastBounces = 0;
    for (let i = 0; i < 60 * 30; i++) {
      sim.advance(1 / 60);
      if (sim.bouncesThisDelivery > lastBounces && !firstBounceZ.has(sim.delivery.index)) {
        firstBounceZ.set(sim.delivery.index, sim.ball.position.z);
      }
      lastBounces = sim.bouncesThisDelivery;
    }
    expect(sim.delivery.index).toBeGreaterThanOrEqual(4);
    expect(firstBounceZ.size).toBeGreaterThanOrEqual(4);
    for (const z of firstBounceZ.values()) {
      expect(z).toBeGreaterThan(BOWLER_STUMPS_Z);
      expect(z).toBeLessThan(STRIKER_STUMPS_Z);
    }
  });

  it('gives the same physical result at 30, 60 and 144 fps', () => {
    const at = (fps: number) => {
      const sim = new DemoBowlingSim('fps');
      for (let i = 0; i < fps * 2; i++) sim.advance(1 / fps);
      return sim.ball.position;
    };
    const a = at(30);
    const b = at(60);
    const c = at(144);
    // Same number of fixed steps ± one, so positions agree to within one step of travel.
    const maxStepTravel = 40 / 240;
    expect(Math.abs(a.z - b.z)).toBeLessThanOrEqual(maxStepTravel);
    expect(Math.abs(b.z - c.z)).toBeLessThanOrEqual(maxStepTravel);
  });
});
