import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { SAMPLE_TEAMS } from '../data/sampleTeams.ts';
import { findPlayer } from '../data/teams.ts';
import { BATTING_ASSIST, type DifficultyId } from '../model/difficulty.ts';
import { rate, simulateStroke } from './harness.ts';
import { attempt } from './shots.ts';

const [m, r] = SAMPLE_TEAMS;
if (!m || !r) throw new Error('teams');
const quick = findPlayer(m, (p) => p.name === 'Sam Adeyemi');
const top = findPlayer(r, (p) => p.name === 'Marcus Lyle');

/** A human: presses with ±50 ms of scatter around the right moment. */
function human(level: DifficultyId | undefined) {
  const rng = new Rng('human');
  const res = Array.from({ length: 150 }, (_, i) =>
    simulateStroke({
      bowler: quick,
      batter: top,
      plan: { type: 'fast', line: 0.25, length: 3.5 },
      attempt: attempt('coverDrive'),
      timingMs: rng.normal() * 50,
      seed: `a${i}`,
      deliverySeed: `d${i}`,
      ...(level ? { assist: BATTING_ASSIST[level] } : {}),
    }),
  );
  return { miss: rate(res, (x) => x.kind === 'miss' || x.kind === 'none'), good: rate(res, (x) => x.kind === 'middled' && x.quality > 0.6) };
}

describe('batting help for a human, by difficulty', () => {
  it('easy forgives most of a human scatter in timing; hard much less', () => {
    const easy = human('easy');
    const normal = human('normal');
    const hard = human('hard');
    expect(easy.miss).toBeLessThan(0.06);
    expect(easy.good).toBeGreaterThan(0.85);
    expect(normal.good).toBeGreaterThan(hard.good);
    expect(hard.good).toBeGreaterThan(human(undefined).good);
  });
});
