import { describe, expect, it } from 'vitest';
import { type ActionKind, actionSpan, armPitchAt } from './motion.ts';

describe('bowling actions', () => {
  const kinds: ActionKind[] = ['pace', 'medium', 'offSpin', 'legSpin'];

  it('the bowling arm turns a full circle backwards-over: down, behind, up, over the top and through', () => {
    for (const kind of kinds) {
      const { start, end } = actionSpan(kind);
      // From the ball at the chin (in front) to the finish, the arm turns through at least 2π.
      expect(armPitchAt(kind, start) - armPitchAt(kind, end)).toBeGreaterThan(Math.PI * 2);
      // From back-foot contact the arm only ever turns one way (no arm going the wrong way round).
      let prev = armPitchAt(kind, -0.24);
      for (let tau = -0.23; tau <= end; tau += 0.01) {
        const v = armPitchAt(kind, tau);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
    }
  });

  it('releases with the arm high: just past vertical', () => {
    for (const kind of kinds) {
      const atRelease = armPitchAt(kind, 0);
      // −π is straight up; a release a little in front of vertical.
      expect(atRelease).toBeLessThan(-Math.PI);
      expect(atRelease).toBeGreaterThan(-Math.PI - 0.35);
    }
  });

  it('spinners have a shorter delivery stride than fast bowlers', () => {
    expect(actionSpan('offSpin').start).toBeGreaterThan(actionSpan('pace').start);
  });
});
