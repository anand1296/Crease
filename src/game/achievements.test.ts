import { afterEach, describe, expect, it, vi } from 'vitest';
import { earned, earnedByResult, readAchievements, unlock } from './achievements.ts';
import type { BallOutcome } from './session/deliveryCycle.ts';

const ball = (o: Partial<BallOutcome>): BallOutcome => ({ runs: 0, extras: 0, noBall: false, wide: false, headline: '', detail: '', ...o }) as BallOutcome;

afterEach(() => vi.unstubAllGlobals());

describe('achievements', () => {
  it('batting: boundaries, a perfectly timed stroke, fifties, a dive that made it', () => {
    expect(earned({ outcome: ball({ boundary: 6, runs: 6 }), batting: true, batterRuns: 6 })).toContain('firstSix');
    expect(earned({ outcome: ball({ contact: { kind: 'middled' } as never }), batting: true, batterRuns: 0, timingMs: -8 })).toContain('perfect');
    expect(earned({ outcome: ball({ contact: { kind: 'middled' } as never }), batting: true, batterRuns: 0, timingMs: 40 })).not.toContain('perfect');
    expect(earned({ outcome: ball({ runs: 2 }), batting: true, batterRuns: 52 })).toContain('fifty');
    expect(earned({ outcome: ball({ runs: 1 }), batting: true, batterRuns: 1, dived: true })).toContain('diveHome');
  });

  it('bowling: wickets, bowled, a yorker, a maiden; and winning', () => {
    const got = earned({ outcome: ball({ wicket: { kind: 'bowled', batter: 'striker' } }), batting: false, batterRuns: 0, deliveryType: 'yorker' });
    expect(got).toEqual(expect.arrayContaining(['firstWicket', 'bowledHim', 'yorkerWicket']));
    expect(earned({ outcome: ball({ wicket: { kind: 'runOut', batter: 'striker' } }), batting: false, batterRuns: 0 })).toEqual([]);
    expect(earnedByResult({ won: true, battedSecond: true, superOver: false })).toEqual(['win', 'chase']);
    expect(earnedByResult({ won: false, battedSecond: true, superOver: true })).toEqual([]);
  });

  it('kept in the browser, and only announced the first time', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(unlock(['firstFour', 'firstFour'])).toEqual(['firstFour']);
    expect(unlock(['firstFour', 'firstSix'])).toEqual(['firstSix']);
    expect(Object.keys(readAchievements()).sort()).toEqual(['firstFour', 'firstSix']);
  });
});
