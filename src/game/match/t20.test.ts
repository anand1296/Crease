import { describe, expect, it } from 'vitest';
import { TEAMS, type Team } from '../data/teams.ts';
import { Match } from './match.ts';
import { defaultXi, keeperFor } from './squad.ts';

const side = (t: Team | undefined) => {
  if (!t) throw new Error('team');
  const xi = defaultXi(t);
  return { team: t, xi, keeperId: keeperFor(t, xi)?.id ?? '', controller: 'ai' as const };
};

describe('T20 (computer v computer, real squads)', () => {
  it('scores at T20 rates: first innings 130–230, 7–11.5 an over', () => {
    let runs = 0;
    let balls = 0;
    const games = [
      [0, 1, 'a'],
      [2, 3, 'b'],
      [3, 0, 'c'],
      [1, 2, 'd'],
    ] as const;
    for (const [a, b, seed] of games) {
      const m = new Match({ home: side(TEAMS[a]), away: side(TEAMS[b]), overs: 20, battingFirst: 'home', pitch: 'balanced', difficulty: 'normal', seed });
      while (m.phase !== 'complete' && m.time < 60000) m.step(1 / 240);
      expect(m.phase).toBe('complete');
      const first = m.innings[0];
      if (!first) throw new Error('no innings');
      runs += first.runs;
      balls += first.balls;
    }
    const avg = runs / games.length;
    const rpo = (runs / balls) * 6;
    expect(avg).toBeGreaterThan(130);
    expect(avg).toBeLessThan(230);
    expect(rpo).toBeGreaterThan(7);
    expect(rpo).toBeLessThan(11.5);
  }, 120_000);
});
