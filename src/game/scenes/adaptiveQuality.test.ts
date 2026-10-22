import { describe, expect, it } from 'vitest';
import { FrameBudgetController } from './adaptiveQuality.ts';

const opts = { window: 10, slow: 1 / 45, smooth: 1 / 55, upgradeAfter: 2, maxLevel: 3, settle: 0 };

/** Feeds `n` frames of `dt` seconds; returns the level afterwards. */
function run(b: FrameBudgetController, level: number, dt: number, n: number): number {
  let l = level;
  for (let i = 0; i < n; i++) l = b.push(dt, l) ?? l;
  return l;
}

describe('adaptive frame budget', () => {
  it('stays at full quality when frames are smooth', () => {
    const b = new FrameBudgetController(opts);
    expect(run(b, 0, 1 / 60, 200)).toBe(0);
  });

  it('goes lighter one level per slow window, down to the lightest', () => {
    const b = new FrameBudgetController(opts);
    expect(run(b, 0, 1 / 25, 10)).toBe(1);
    expect(run(b, 1, 1 / 25, 10)).toBe(2);
    expect(run(b, 2, 1 / 25, 100)).toBe(3);
  });

  it('ignores occasional hitches (the median decides)', () => {
    const b = new FrameBudgetController(opts);
    let l = 0;
    for (let i = 0; i < 200; i++) l = b.push(i % 5 === 0 ? 0.25 : 1 / 60, l) ?? l;
    expect(l).toBe(0);
  });

  it('tries a richer level after a smooth stretch, and gives up if that is too slow', () => {
    const b = new FrameBudgetController(opts);
    let l = run(b, 0, 1 / 25, 10);
    expect(l).toBe(1);
    // Smooth again: after two smooth windows, try level 0.
    l = run(b, l, 1 / 60, 20);
    expect(l).toBe(0);
    // Level 0 is too slow after all: back to 1, and stay there however smooth it gets.
    l = run(b, l, 1 / 25, 10);
    expect(l).toBe(1);
    l = run(b, l, 1 / 60, 200);
    expect(l).toBe(1);
  });

  it('ignores frames while settling and gaps of seconds', () => {
    const b = new FrameBudgetController({ ...opts, settle: 5 });
    expect(run(b, 0, 1 / 25, 14)).toBe(0);
    expect(run(b, 0, 1 / 25, 1)).toBe(1);
    const c = new FrameBudgetController(opts);
    expect(run(c, 0, 10, 50)).toBe(0);
  });
});
