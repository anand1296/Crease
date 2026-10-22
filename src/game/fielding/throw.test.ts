import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { planThrow } from '../session/deliveryCycle.ts';

const from = { x: 25, z: 20 };
const many = (power: number, arm = 0.8, n = 400) =>
  Array.from({ length: n }, (_, k) => planThrow({ from, end: 'striker', power, arm, now: 0, collectedAt: 0, rng: new Rng(`t-${power}-${arm}-${k}`) }));
const rate = (xs: ReturnType<typeof many>) => xs.filter((t) => t.plan.direct).length / xs.length;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('throws from the field', () => {
  it('a harder throw gets there sooner; a lob is slow', () => {
    const flat = mean(many(0.8).map((t) => t.plan.arriveAt));
    const lob = mean(many(0.25).map((t) => t.plan.arriveAt));
    expect(lob).toBeGreaterThan(flat + 0.6);
  });

  it('the green zone hits the stumps more often than a forced, wild throw', () => {
    expect(rate(many(0.65))).toBeGreaterThan(rate(many(1.2)) + 0.05);
    // But direct hits from 25 m are never routine.
    expect(rate(many(0.65))).toBeLessThan(0.5);
  });

  it('a better arm throws faster and straighter', () => {
    expect(rate(many(0.65, 1))).toBeGreaterThan(rate(many(0.65, 0.2)));
    expect(mean(many(0.65, 1).map((t) => t.plan.arriveAt))).toBeLessThan(mean(many(0.65, 0.2).map((t) => t.plan.arriveAt)));
  });

  it('without a direct hit the stumps are broken a little later, after the gather', () => {
    const xs = many(0.65);
    for (const t of xs) {
      if (t.plan.direct) expect(t.breakAt).toBeCloseTo(t.plan.arriveAt, 6);
      else expect(t.breakAt).toBeGreaterThan(t.plan.arriveAt + 0.2);
    }
  });
});
