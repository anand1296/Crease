import { describe, expect, it } from 'vitest';
import { TEAMS } from '../data/teams.ts';
import { type MatchConfig, Match, maxOversPerBowler } from './match.ts';
import { checkXi, defaultXi, keeperFor } from './squad.ts';
import type { Team } from '../data/teams.ts';

const team = (i: number): Team => {
  const t = TEAMS[i];
  if (!t) throw new Error('team');
  return t;
};

const side = (t: Team, controller: 'human' | 'ai') => {
  const xi = defaultXi(t);
  return { team: t, xi, keeperId: keeperFor(t, xi)?.id ?? '', controller };
};

const config = (over: Partial<MatchConfig> = {}): MatchConfig => ({
  home: side(team(0), 'ai'),
  away: side(team(1), 'ai'),
  overs: 5,
  battingFirst: 'home',
  pitch: 'balanced',
  difficulty: 'normal',
  seed: 'match',
  ...over,
});

function play(m: Match, maxSeconds = 20000): void {
  const dt = 1 / 240;
  while (m.phase !== 'complete' && m.time < maxSeconds) m.step(dt);
}

describe('squads', () => {
  it('every team has at least 15 players, a specialist keeper and a valid default XI', () => {
    expect(TEAMS.length).toBeGreaterThanOrEqual(4);
    for (const t of TEAMS) {
      expect(t.players.length).toBeGreaterThanOrEqual(15);
      expect(t.keeperIds.length).toBeGreaterThanOrEqual(1);
      const check = checkXi(t, defaultXi(t));
      expect(check.errors).toEqual([]);
      expect(check.warnings.filter((w) => w.startsWith('Only'))).toEqual([]);
    }
  });

  it('rejects XIs of the wrong size or with duplicates', () => {
    const t = team(2);
    expect(checkXi(t, t.players.slice(0, 10)).ok).toBe(false);
    const xi = t.players.slice(0, 11);
    const dup = [...xi.slice(0, 10), xi[0]].filter((p) => p !== undefined);
    expect(checkXi(t, dup).ok).toBe(false);
  });
});

describe('Match (computer v computer)', () => {
  it('plays two innings to a consistent result', () => {
    const m = new Match(config());
    play(m);
    expect(m.phase).toBe('complete');
    expect(m.innings.length).toBe(2);
    const [first, second] = m.innings;
    if (!first || !second || !m.result) throw new Error('incomplete');
    expect(second.target).toBe(first.runs + 1);
    for (const inn of m.innings) {
      expect(inn.balls).toBeLessThanOrEqual(5 * 6);
      expect(inn.wickets).toBeLessThanOrEqual(10);
      expect(inn.endReason).toBeDefined();
      // Scorecards add up.
      const batRuns = inn.battingCards.reduce((a, c) => a + c.runs, 0);
      expect(batRuns + inn.wides + inn.noBalls).toBe(inn.runs);
      const bowlRuns = inn.bowlingCards.reduce((a, c) => a + c.runs, 0);
      expect(bowlRuns).toBe(inn.runs);
      const bowlBalls = inn.bowlingCards.reduce((a, c) => a + c.balls, 0);
      expect(bowlBalls).toBe(inn.balls);
      expect(inn.battingCards.filter((c) => c.dismissal).length).toBe(inn.wickets);
      expect(inn.fallOfWickets.length).toBe(inn.wickets);
      // Bowler limits.
      for (const c of inn.bowlingCards) expect(Math.ceil(c.balls / 6)).toBeLessThanOrEqual(maxOversPerBowler(5));
    }
    if (second.runs > first.runs) {
      expect(m.result.winner).toBe(second.batting);
      expect(second.endReason).toBe('target');
    } else if (second.runs < first.runs) {
      expect(m.result.winner).toBe(first.batting);
    } else {
      expect(m.result.tie).toBe(true);
    }
  });

  it('never lets a bowler bowl consecutive overs', () => {
    const m = new Match(config({ seed: 'consecutive', overs: 6 }));
    const overBowlers: string[] = [];
    let lastBalls = -1;
    const dt = 1 / 240;
    while (m.phase !== 'complete' && m.time < 20000) {
      m.step(dt);
      const inn = m.current;
      if (m.innings.length === 1 && inn.balls !== lastBalls && inn.balls % 6 === 1) overBowlers.push(m.bowler.id);
      lastBalls = inn.balls;
    }
    for (let i = 1; i < overBowlers.length; i++) expect(overBowlers[i]).not.toBe(overBowlers[i - 1]);
  });

  it('is deterministic for a seed', () => {
    const a = new Match(config({ seed: 'det' }));
    const b = new Match(config({ seed: 'det' }));
    play(a);
    play(b);
    expect(a.result).toEqual(b.result);
    expect(a.innings.map((i) => i.runs)).toEqual(b.innings.map((i) => i.runs));
  });

  it('chases sensibly: the second innings stops as soon as the target is passed', () => {
    for (const seed of ['c1', 'c2', 'c3', 'c4']) {
      const m = new Match(config({ seed, overs: 4 }));
      play(m);
      const second = m.innings[1];
      if (second?.endReason === 'target') expect(second.runs - (second.target ?? 0)).toBeLessThanOrEqual(6);
    }
  });
});

/** Steps the match, pressing "next" whenever it waits for the player. */
function tick(m: Match, dt: number): void {
  if (m.phase === 'review') m.next();
  else m.step(dt);
}

describe('Match (human)', () => {
  it('a human bowling side chooses each over’s bowler from the eligible list', () => {
    const m = new Match(config({ home: side(team(0), 'human'), battingFirst: 'away', seed: 'captain' }));
    const dt = 1 / 240;
    while (m.phase !== 'chooseBowler') tick(m, dt);
    const eligible = m.eligibleBowlers();
    expect(eligible.length).toBeGreaterThanOrEqual(5);
    expect(eligible.some((p) => p.id === m.keeperOf('home').id)).toBe(false);
    const pick = eligible[2];
    if (!pick) throw new Error('no bowler');
    expect(m.chooseBowler(pick.id)).toBe(true);
    expect(m.bowler.id).toBe(pick.id);
    expect(m.phase).toBe('aiming');
    // Bowl the over; the same bowler is then not eligible.
    const phase = () => m.phase;
    for (let ball = 0; ball < 6; ball++) {
      while (phase() !== 'aiming') tick(m, dt);
      m.bowlButton();
      while (phase() === 'delivery') tick(m, dt);
      if (m.current.balls >= 6) break;
    }
    while (phase() !== 'chooseBowler' && phase() !== 'complete' && phase() !== 'inningsBreak') tick(m, dt);
    if (phase() === 'chooseBowler') expect(m.eligibleBowlers().some((p) => p.id === pick.id)).toBe(false);
  });

  it('a human batter who calls no runs scores only boundaries', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'no-runs', overs: 2 }));
    const dt = 1 / 240;
    while (m.history.length < 8 && m.phase !== 'complete' && m.time < 2000) tick(m, dt);
    for (const o of m.history) expect(o.runs === 0 || o.boundary !== undefined).toBe(true);
  });

  it('waits for the player after every ball, and summarises overs and wickets', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'review', overs: 3 }));
    const dt = 1 / 240;
    const kinds = new Set<string>();
    let waited = 0;
    let wicketCards = 0;
    let overSummaries = 0;
    while (m.phase !== 'complete' && m.phase !== 'inningsBreak' && m.time < 5000) {
      m.step(dt);
      if (m.phase === 'review') {
        const r = m.review;
        if (!r) throw new Error('review without details');
        kinds.add(r.kind);
        // It really waits: stepping does nothing until the player moves on.
        const balls = m.history.length;
        for (let i = 0; i < 2400; i++) m.step(dt);
        expect(m.phase).toBe('review');
        expect(m.history.length).toBe(balls);
        if (r.kind === 'over' || (r.kind === 'wicket' && r.over)) overSummaries += 1;
        if (r.kind === 'over') {
          expect(r.over.balls.length).toBeGreaterThanOrEqual(6);
          expect(r.over.number).toBeGreaterThanOrEqual(1);
        }
        if (r.kind === 'wicket') {
          wicketCards += 1;
          expect(r.batter.dismissal).toBeDefined();
          expect(r.fall.batter).toBe(r.batter.player.name);
        }
        waited += 1;
        expect(m.next()).toBe(true);
        expect(m.phase).toBe('between');
      }
    }
    expect(waited).toBeGreaterThanOrEqual(12);
    expect(kinds.has('ball')).toBe(true);
    // Overs are summarised (on their own, or on the wicket card when the last ball took a wicket).
    expect(overSummaries).toBeGreaterThanOrEqual(2);
    // Every wicket got a wicket card.
    const wickets = m.history.filter((o) => o.wicket).length;
    expect(wicketCards).toBe(wickets);
  });

  it('runs at the chosen speed without changing what happens', () => {
    const a = new Match(config({ seed: 'speed' }));
    const b = new Match(config({ seed: 'speed' }));
    b.speed = 0.65;
    let fa = 0;
    let fb = 0;
    while (a.phase !== 'complete' && fa < 200000) {
      a.advance(1 / 60);
      fa++;
    }
    while (b.phase !== 'complete' && fb < 300000) {
      b.advance(1 / 60);
      fb++;
    }
    expect(b.result?.summary).toBe(a.result?.summary);
    expect(fb / fa).toBeCloseTo(1 / 0.65, 1);
  });
});
