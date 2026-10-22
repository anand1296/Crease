import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ALL_SHOTS, attempt, SHOTS } from '../../batting/shots.ts';
import { REACH, SWEET, familyOf, strokeFrame } from './strokes.ts';

const stance = new Vector3(-0.45, 0, 9.1);

describe('stroke motion', () => {
  it('at contact the bat’s sweet spot is on the ball, for every stroke and both hands', () => {
    for (const shot of ALL_SHOTS) {
      if (shot === 'leave') continue;
      for (const off of [1, -1] as const) {
        const contact = new Vector3(0.25 * off, SHOTS[shot].idealHeight.min + 0.1, 8.6);
        const f = strokeFrame({ attempt: attempt(shot), off, contact, aimDeg: SHOTS[shot].direction, k: 1, follow: 0, stance });
        const sweet = f.hands.clone().addScaledVector(f.bat, SWEET);
        expect(sweet.distanceTo(contact)).toBeLessThan(0.12);
      }
    }
  });

  it('keeps the hands within reach of the shoulders throughout', () => {
    for (const shot of ALL_SHOTS) {
      for (const k of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        for (const follow of [0, 0.5, 1]) {
          const f = strokeFrame({ attempt: attempt(shot), off: 1, contact: new Vector3(0.3, 0.5, 8.5), aimDeg: SHOTS[shot].direction, k, follow: k < 1 ? 0 : follow, stance });
          const shoulders = new Vector3(f.root.x, 1.42 - f.drop, f.root.z);
          expect(f.hands.distanceTo(shoulders)).toBeLessThanOrEqual(REACH + 1e-6);
        }
      }
    }
  });

  it('different strokes have different shapes: a drive finishes high, a cut across the body, a block not at all', () => {
    const finish = (shot: Parameters<typeof attempt>[0]) =>
      strokeFrame({ attempt: attempt(shot), off: 1, contact: new Vector3(0.3, 0.6, 8.5), aimDeg: SHOTS[shot].direction, k: 1, follow: 1, stance });
    const at = (shot: Parameters<typeof attempt>[0]) =>
      strokeFrame({ attempt: attempt(shot), off: 1, contact: new Vector3(0.3, 0.6, 8.5), aimDeg: SHOTS[shot].direction, k: 1, follow: 0, stance });
    expect(finish('straightDrive').bat.y).toBeGreaterThan(0.6);
    expect(finish('squareCut').bat.x).toBeLessThan(-0.3);
    expect(finish('block').bat.distanceTo(at('block').bat)).toBeLessThan(1e-6);
    // A cut's bat is horizontal at contact; a drive's is vertical.
    expect(Math.abs(at('squareCut').bat.y)).toBeLessThan(0.5);
    expect(at('straightDrive').bat.y).toBeLessThan(-0.9);
    expect(familyOf('sweep')).toBe('sweep');
  });

  it('stepping out takes the batter well down the pitch', () => {
    const f = strokeFrame({ attempt: attempt('straightDrive', 'out'), off: 1, contact: new Vector3(0.1, 0.4, 7.2), aimDeg: 0, k: 1, follow: 0, stance });
    expect(stance.z - f.root.z).toBeGreaterThan(1.2);
  });
});
