import { describe, expect, it } from 'vitest';
import { COIN_THICKNESS, coinAt, coinFor, computerChoice, faceUp, flightTime } from './toss.ts';

describe('the toss', () => {
  it('is decided by the seed, and both faces come up', () => {
    expect(coinFor('a')).toBe(coinFor('a'));
    const faces = new Set(Array.from({ length: 40 }, (_, i) => coinFor(`seed-${i}`)));
    expect(faces).toEqual(new Set(['heads', 'tails']));
  });

  it('a computer captain bats on a flat deck and bowls on a green one', () => {
    expect(computerChoice('flat', 'x')).toBe('bat');
    expect(computerChoice('green', 'x')).toBe('bowl');
  });

  it('the coin goes up about a metre, comes down, and lands showing the face it was decided on', () => {
    const from = { x: 0.3, y: 1.25, z: 0 };
    for (const face of ['heads', 'tails'] as const) {
      const T = flightTime(from.y);
      expect(T).toBeGreaterThan(0.9);
      expect(T).toBeLessThan(1.3);
      let top = 0;
      let prevFlip = 0;
      for (let t = 0.01; t < T; t += 0.01) {
        const c = coinAt(t, from, { x: 0.1, z: 0.2 }, face);
        top = Math.max(top, c.y);
        expect(c.landed).toBe(false);
        // It keeps turning the same way.
        expect(c.flip).toBeGreaterThanOrEqual(prevFlip);
        prevFlip = c.flip;
      }
      expect(top - from.y).toBeGreaterThan(0.8);
      expect(top - from.y).toBeLessThan(1.2);
      const rest = coinAt(T + 2, from, { x: 0.1, z: 0.2 }, face);
      expect(rest.landed).toBe(true);
      expect(rest.y).toBeCloseTo(COIN_THICKNESS / 2, 4);
      expect(faceUp(rest.flip)).toBe(face);
      // Flat: a whole number of half turns.
      expect(Math.abs(Math.sin(rest.flip))).toBeLessThan(1e-3);
    }
  });
});
