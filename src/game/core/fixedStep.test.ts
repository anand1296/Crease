import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './fixedStep.ts';

const opts = { stepSeconds: 0.01, maxFrameSeconds: 0.05 };

describe('FixedStepClock', () => {
  it('runs the same number of steps regardless of frame rate', () => {
    const at60 = new FixedStepClock(opts);
    const at144 = new FixedStepClock(opts);
    let steps60 = 0;
    let steps144 = 0;
    for (let i = 0; i < 60; i++) steps60 += at60.advance(1 / 60);
    for (let i = 0; i < 144; i++) steps144 += at144.advance(1 / 144);
    // One simulated second either way (±1 step of accumulator remainder).
    expect(Math.abs(steps60 - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(steps144 - 100)).toBeLessThanOrEqual(1);
  });

  it('clamps long frames to avoid a catch-up spiral', () => {
    const clock = new FixedStepClock(opts);
    expect(clock.advance(5)).toBe(5);
  });

  it('ignores invalid deltas', () => {
    const clock = new FixedStepClock(opts);
    expect(clock.advance(-1)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.advance(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('exposes the leftover fraction for interpolation and resets it', () => {
    const clock = new FixedStepClock(opts);
    clock.advance(0.025);
    expect(clock.alpha).toBeCloseTo(0.5, 5);
    clock.reset();
    expect(clock.alpha).toBe(0);
  });

  it('rejects invalid configuration', () => {
    expect(() => new FixedStepClock({ stepSeconds: 0, maxFrameSeconds: 1 })).toThrow();
    expect(() => new FixedStepClock({ stepSeconds: 0.1, maxFrameSeconds: 0.01 })).toThrow();
  });
});
