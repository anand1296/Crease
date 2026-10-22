import { describe, expect, it } from 'vitest';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import type { BallOutcome } from '../session/deliveryCycle.ts';
import { TEAMS } from '../data/teams.ts';
import { Match } from '../match/match.ts';
import { defaultXi, keeperFor } from '../match/squad.ts';
import { challenge, markerFor, markerHit } from './challenges.ts';

const ball = (o: Partial<BallOutcome> & { fromStumps?: number; x?: number; height?: number } = {}): BallOutcome => ({
  runs: 0,
  extras: 0,
  noBall: false,
  wide: false,
  headline: '',
  detail: '',
  ...o,
  delivery: {
    name: 'x',
    speedKph: 130,
    line: 0,
    ...(o.fromStumps !== undefined ? { length: STRIKER_STUMPS_Z - o.fromStumps, pitchX: o.x ?? 0 } : {}),
    ...(o.height !== undefined ? { height: o.height } : {}),
    ...(o.delivery?.type ? { type: o.delivery.type } : {}),
  },
});

describe('practice challenges', () => {
  it('fifteen off the over: won as soon as it is reached, lost when it cannot be', () => {
    const c = challenge('fifteen');
    expect(c.check([ball({ runs: 6, boundary: 6 }), ball({ runs: 4, boundary: 4 }), ball({ runs: 6, boundary: 6 })], false, 1).state).toBe('won');
    const dots = Array.from({ length: 4 }, () => ball());
    expect(c.check(dots, false, 1).state).toBe('lost'); // 2 balls left: 12 at most
    expect(c.check(dots.slice(0, 3), false, 1).state).toBe('on');
  });

  it('survive: lost at the first wicket, won at the end of the over', () => {
    const c = challenge('survive');
    expect(c.check([ball(), ball({ wicket: { kind: 'bowled', batter: 'striker' } })], false, 1).state).toBe('lost');
    expect(c.check(Array.from({ length: 6 }, () => ball()), true, 1).state).toBe('won');
    // A wide is not one of the six.
    expect(c.check([...Array.from({ length: 5 }, () => ball()), ball({ wide: true, extras: 1 })], false, 1).state).toBe('on');
  });

  it('yorkers and bouncers are judged by where the ball pitched and how high it got', () => {
    const y = challenge('yorkers');
    expect(y.check([ball({ fromStumps: 0.8 }), ball({ fromStumps: 1.4 })], false, 1).state).toBe('won');
    expect(y.check([ball({ fromStumps: 3 })], false, 1).progress).toContain('0 of 2');
    const b = challenge('bouncers');
    expect(b.check([ball({ fromStumps: 10, height: 1.6 }), ball({ fromStumps: 9, height: 1.5 })], false, 1).state).toBe('won');
    expect(b.check([ball({ fromStumps: 10, height: 0.9 })], false, 1).progress).toContain('0 of 2');
  });

  it('markers: each ball has its own spot; landing within the ring counts', () => {
    const m0 = markerFor(0, 1);
    const hit = ball({ fromStumps: STRIKER_STUMPS_Z - m0.z, x: m0.x + 0.2 });
    const miss = ball({ fromStumps: STRIKER_STUMPS_Z - m0.z + 1.5, x: m0.x });
    expect(markerHit(hit, 0, 1)).toBe(true);
    expect(markerHit(miss, 0, 1)).toBe(false);
    // Mirrored for a left-hander.
    expect(markerFor(0, -1).x).toBe(-m0.x);
  });

  it('a practice match is one over and ends as soon as the challenge is decided', () => {
    const t0 = TEAMS[0];
    const t1 = TEAMS[1];
    if (!t0 || !t1) throw new Error('teams');
    const side = (t: typeof t0, c: 'human' | 'ai') => {
      const xi = defaultXi(t);
      return { team: t, xi, keeperId: keeperFor(t, xi)?.id ?? '', controller: c };
    };
    const m = new Match({ home: side(t0, 'human'), away: side(t1, 'ai'), overs: 1, battingFirst: 'home', pitch: 'balanced', difficulty: 'normal', seed: 'nets', practice: 'survive' });
    // The quickest bowler opens.
    expect(['fast', 'fastMedium']).toContain(m.bowler.bowlingStyle);
    m.startAutoplay('innings');
    while (m.phase !== 'complete' && m.time < 600) {
      if (m.phase === 'review') m.next();
      else m.step(1 / 240);
    }
    expect(m.phase).toBe('complete');
    expect(m.innings.length).toBe(1);
    expect(m.current.balls).toBeLessThanOrEqual(6);
    expect(m.result?.summary).toMatch(/Challenge (complete|failed)/);
    // Survival fails only by getting out.
    if (m.challengeStatus?.state === 'lost') expect(m.current.wickets).toBeGreaterThan(0);
    else expect(m.current.wickets).toBe(0);
  });
});
