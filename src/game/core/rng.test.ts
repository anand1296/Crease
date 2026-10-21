import { describe, expect, it } from 'vitest';
import { Rng } from './rng.ts';

describe('Rng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new Rng('match-42');
    const b = new Rng('match-42');
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 100 }, () => a.next() === b.next()).filter(Boolean).length;
    expect(same).toBeLessThan(3);
  });

  it('round-trips its state for save and replay', () => {
    const a = new Rng('seed');
    for (let i = 0; i < 37; i++) a.next();
    const b = Rng.fromState(a.getState());
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it('keeps uniform samples in [0, 1) with a sane mean', () => {
    const rng = new Rng('uniform');
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
  });

  it('respects integer bounds inclusively', () => {
    const rng = new Rng('int');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('bounds error samples to the configured number of deviations', () => {
    const rng = new Rng('bounded');
    for (let i = 0; i < 20000; i++) {
      expect(Math.abs(rng.boundedNormal(2, 2.5))).toBeLessThanOrEqual(5);
    }
  });

  it('forks reproducible, independent child streams', () => {
    const childA = new Rng('parent').fork('delivery-1');
    const childB = new Rng('parent').fork('delivery-1');
    const childC = new Rng('parent').fork('delivery-2');
    const a = childA.next();
    expect(childB.next()).toBe(a);
    expect(childC.next()).not.toBe(a);
  });
});
