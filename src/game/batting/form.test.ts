import { describe, expect, it } from 'vitest';
import { TEAMS } from '../data/teams.ts';
import { DELIVERY_TYPES } from '../bowling/deliveryTypes.ts';
import { fatigueAfterBall } from '../bowling/fatigue.ts';
import { defaultXi } from '../match/squad.ts';
import { confidenceAfter, fatigueAfter, powerScale, startingConfidence, timingScale } from './form.ts';

const team = TEAMS[0];
if (!team) throw new Error('team');
const xi = defaultXi(team);
const at = (i: number) => {
  const p = xi[i];
  if (!p) throw new Error('player');
  return p;
};

describe('batter form', () => {
  it('top-order batters walk out with more confidence than tailenders', () => {
    const top = startingConfidence(at(0), 0);
    const tail = startingConfidence(at(10), 10);
    expect(top).toBeGreaterThan(0.55);
    expect(tail).toBeLessThan(0.4);
  });

  it('boundaries and well-timed shots build confidence; misses and edges cost it', () => {
    let c = 0.5;
    c = confidenceAfter(c, { contact: 'clean', timing: 0.1, boundary: 4, ranRuns: 0 });
    c = confidenceAfter(c, { contact: 'clean', timing: 0.05, boundary: 6, ranRuns: 0 });
    expect(c).toBeGreaterThan(0.6);
    let d = 0.5;
    for (let i = 0; i < 3; i++) d = confidenceAfter(d, { contact: 'miss', ranRuns: 0 });
    expect(d).toBeLessThan(0.4);
    expect(confidenceAfter(0.99, { contact: 'clean', timing: 0, boundary: 6, ranRuns: 0 })).toBeLessThanOrEqual(1);
  });

  it('confidence widens the timing window (and so the sweet spot on the gauge); tiredness narrows it', () => {
    expect(timingScale({ confidence: 1, fatigue: 0 })).toBeCloseTo(1.28, 5);
    expect(timingScale({ confidence: 0, fatigue: 0 })).toBeCloseTo(0.72, 5);
    expect(timingScale({ confidence: 0.5, fatigue: 0 })).toBeCloseTo(1, 5);
    expect(timingScale({ confidence: 0.5, fatigue: 1 })).toBeLessThan(0.9);
    expect(powerScale({ confidence: 0.5, fatigue: 1 })).toBeLessThan(1);
  });

  it('twos and threes tire a batter far more than singles, and so does a long stay', () => {
    const one = fatigueAfter(0, 1, 5, 120);
    const three = fatigueAfter(0, 3, 5, 120);
    expect(three).toBeGreaterThan(one * 5);
    expect(fatigueAfter(0.2, 0, 30, 120)).toBeGreaterThan(fatigueAfter(0.2, 0, 10, 120));
  });
});

describe('bowler stamina', () => {
  it('bowling flat out and long spells tire a bowler faster', () => {
    const fast = DELIVERY_TYPES.fast;
    expect(fatigueAfterBall(0, 60, fast, 1)).toBeGreaterThan(fatigueAfterBall(0, 60, fast, 0.75));
    expect(fatigueAfterBall(0, 60, fast, 0.75, 4)).toBeGreaterThan(fatigueAfterBall(0, 60, fast, 0.75, 1));
  });
});
