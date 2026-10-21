import { describe, expect, it } from 'vitest';
import { renderBatHit } from './sound.ts';

const SR = 48000;
const middled = { quality: 0.95, speed: 38, edge: false, along: 0.01, across: 0.005 };
const toe = { quality: 0.45, speed: 20, edge: false, along: -0.17, across: 0.02 };
const edge = { quality: 0.3, speed: 18, edge: true, along: 0.02, across: 0.05 };

/** Fraction of energy within [lo, hi] Hz (plain DFT on the first 60 ms). */
function bandShare(x: Float32Array, lo: number, hi: number): number {
  const n = Math.min(x.length, Math.round(SR * 0.06));
  let band = 0;
  let total = 0;
  for (let f = 50; f <= 8000; f += 50) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * f * i) / SR;
      re += (x[i] ?? 0) * Math.cos(w);
      im -= (x[i] ?? 0) * Math.sin(w);
    }
    const e = re * re + im * im;
    total += e;
    if (f >= lo && f <= hi) band += e;
  }
  return band / total;
}

/** Milliseconds until the signal stays below 1 % of its peak. */
function ringMs(x: Float32Array): number {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let last = 0;
  x.forEach((v, i) => {
    if (Math.abs(v) > peak * 0.01) last = i;
  });
  return (last / SR) * 1000;
}

describe('bat-on-ball sound', () => {
  it('is deterministic for a given seed', () => {
    expect(Array.from(renderBatHit(middled, SR, 7).slice(0, 500))).toEqual(Array.from(renderBatHit(middled, SR, 7).slice(0, 500)));
  });

  it('a middled hit is a short, bright crack', () => {
    const s = renderBatHit(middled, SR, 1);
    expect(bandShare(s, 800, 4000)).toBeGreaterThan(0.6);
    expect(ringMs(s)).toBeLessThan(45);
  });

  it('a hit off the toe is duller and rings on (the bat\'s bending modes)', () => {
    const good = renderBatHit(middled, SR, 1);
    const bad = renderBatHit(toe, SR, 1);
    expect(bandShare(bad, 50, 800)).toBeGreaterThan(bandShare(good, 50, 800) + 0.4);
    expect(ringMs(bad)).toBeGreaterThan(ringMs(good) * 1.8);
  });

  it('an edge is a thin, quieter tick', () => {
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const e = renderBatHit(edge, SR, 1);
    expect(peak(e)).toBeLessThan(peak(renderBatHit(middled, SR, 1)) * 0.7);
    expect(bandShare(e, 800, 6000)).toBeGreaterThan(0.7);
  });

  it('a harder hit is louder', () => {
    const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak(renderBatHit({ ...middled, speed: 40 }, SR, 1))).toBeGreaterThan(peak(renderBatHit({ ...middled, speed: 8 }, SR, 1)));
  });
});
