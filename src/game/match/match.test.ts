import { describe, expect, it } from 'vitest';
import { TEAMS } from '../data/teams.ts';
import { type MatchConfig, Match, maxOversPerBowler } from './match.ts';
import type { BallOutcome } from '../session/deliveryCycle.ts';
import { applyDrop, checkXi, defaultXi, keeperFor } from './squad.ts';
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
      // Delivery chosen → marker placed → run in.
      m.bowlButton();
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
        // The start card leads to the build-up in the middle, which waits for the player too.
        if (r.kind === 'start') {
          expect(m.review?.kind).toBe('ready');
          for (let i = 0; i < 2400; i++) m.step(dt);
          expect(m.phase).toBe('review');
          expect(m.next()).toBe(true);
        }
        expect(m.phase).toBe('between');
      }
    }
    expect(waited).toBeGreaterThanOrEqual(12);
    expect(kinds.has('ball')).toBe(true);
    // Overs are summarised (on their own, or on the wicket card when the last ball took a wicket).
    expect(overSummaries).toBeGreaterThanOrEqual(2);
    // Every wicket got a wicket card — except one that ends the innings, which goes to the innings break.
    const wickets = m.history.filter((o) => o.wicket).length;
    expect(wicketCards).toBe(wickets - (m.current.wickets >= 10 ? 1 : 0));
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

describe('Hat-trick', () => {
  it('two wickets in two balls by the same bowler: on a hat-trick; a third is the hat-trick', () => {
    const m = new Match(config({ seed: 'hat' }));
    const record = (o: BallOutcome) => (m as unknown as { record(o: BallOutcome): void }).record(o);
    const out: BallOutcome = { runs: 0, extras: 0, noBall: false, wide: false, wicket: { kind: 'bowled', batter: 'striker' }, headline: 'BOWLED!', detail: '', delivery: { name: 'x', speedKph: 140, line: 0 } };
    record(out);
    expect(m.hatTrickBall).toBe(false);
    record(out);
    expect(m.hatTrickBall).toBe(true);
    record(out);
    expect(m.lastOutcome?.headline).toBe('HAT-TRICK!');
    // A ball without a wicket ends it.
    record({ ...out, wicket: undefined } as unknown as BallOutcome);
    expect(m.hatTrickBall).toBe(false);
  });
});

describe('Super over', () => {
  it('a tie goes to a super over: one over each, two wickets, the side batting second goes first', () => {
    let found = 0;
    for (let i = 0; i < 400 && found < 3; i++) {
      const m = new Match(config({ overs: 1, seed: `tie-${i}` }));
      play(m, 3000);
      if (m.innings.length <= 2) continue;
      found += 1;
      const [first, second, so1, so2] = m.innings;
      expect(first?.runs).toBe(second?.runs);
      expect(so1?.batting).toBe(second?.batting);
      for (const so of m.innings.slice(2)) {
        expect(so.balls).toBeLessThanOrEqual(6);
        expect(so.wickets).toBeLessThanOrEqual(2);
      }
      expect(m.phase).toBe('complete');
      if (so1 && so2 && so1.runs !== so2.runs && m.innings.length === 4) {
        expect(m.result?.summary).toContain('won the super over');
        expect(m.result?.winner).toBe(so2.runs > so1.runs ? so2.batting : so1.batting);
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("The human captain's field", () => {
  it('his own field is used when legal, and refused when it breaks the restrictions', () => {
    const m = new Match(config({ home: side(team(0), 'human'), battingFirst: 'away', seed: 'own-field' }));
    while (m.phase !== 'chooseBowler') tick(m, 1 / 240);
    const spots = m.currentPositions();
    expect(spots.length).toBe(9);
    // Powerplay: three on the boundary is one too many.
    const three = spots.map((p, i) => (i < 3 ? { ...p, distance: 60 } : { ...p, distance: Math.min(p.distance, 25) }));
    expect(m.setCustomField(three)).toContain('Only 2');
    const legal = spots.map((p, i) => ({ ...p, distance: i === 0 ? 60 : Math.min(p.distance, 22) }));
    expect(m.setCustomField(legal)).toBeUndefined();
    expect(m.fieldPreset).toBe('custom');
    const pick = m.eligibleBowlers()[0];
    if (!pick) throw new Error('bowler');
    m.chooseBowler(pick.id);
    const deep = m.field.filter((f) => !f.keeper && Math.hypot(f.start.x, f.start.z - 10.06) > 50);
    expect(deep.length).toBe(1);
  });
});

describe('Autoplay', () => {
  const dt = 1 / 240;

  it('plays the rest of the over for the batter without stopping, then hands back with the over card', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'auto-over', overs: 5 }));
    expect(m.phase).toBe('review');
    expect(m.startAutoplay('over')).toBe(true);
    expect(m.autoplay).toBe('over');
    let reviews = 0;
    while (m.phase !== 'review' && m.phase !== 'inningsBreak' && m.time < 2000) {
      tick(m, dt);
      if (m.phase === 'delivery') expect(m.humanBatting).toBe(false);
    }
    if (m.phase === 'review') reviews += 1;
    expect(reviews).toBe(1);
    expect(m.current.balls).toBe(6);
    expect(m.autoplay).toBe('off');
    expect(m.humanBatting).toBe(true);
    expect(m.review?.kind === 'over' || m.review?.kind === 'wicket').toBe(true);
  });

  it('mid-over, plays only to the end of that over', () => {
    const m = new Match(config({ home: side(team(0), 'human'), seed: 'auto-mid', overs: 5 }));
    m.next();
    while (m.current.balls < 2 && m.time < 2000) {
      tick(m, dt);
      if (m.phase === 'review') m.next();
    }
    while (m.phase !== 'review') tick(m, dt);
    expect(m.startAutoplay('over')).toBe(true);
    while (m.phase !== 'review' && m.phase !== 'inningsBreak' && m.time < 2000) tick(m, dt);
    expect(m.current.balls).toBe(6);
  });

  it('bowls the whole innings for the human captain, stops at the break, and can be called off', () => {
    const m = new Match(config({ home: side(team(0), 'human'), battingFirst: 'away', seed: 'auto-inn', overs: 3 }));
    expect(m.startAutoplay('innings')).toBe(true);
    while (m.phase !== 'inningsBreak' && m.phase !== 'complete' && m.time < 5000) {
      tick(m, dt);
      expect(m.phase === 'review' || m.phase === 'chooseBowler' || m.phase === 'aiming').toBe(false);
    }
    expect(m.phase).toBe('inningsBreak');
    expect(m.autoplay).toBe('off');
    // Every over had a different bowler from the one before.
    expect(m.innings[0]?.bowlingCards.length ?? 0).toBeGreaterThanOrEqual(2);
    m.continueAfterBreak();
    expect(m.phase).toBe('review');
    expect(m.startAutoplay('innings')).toBe(true);
    while (m.history.length < 9 + 2 && m.time < 8000) tick(m, dt);
    m.stopAutoplay();
    expect(m.autoplay).toBe('off');
    // The ball in progress is finished by the computer; then the player has the controls.
    while (m.phase !== 'review' && m.time < 8000) tick(m, dt);
    expect(m.humanBatting).toBe(true);
  });
});

describe('Human bowling: delivery, landing marker, run-up', () => {
  const dt = 1 / 240;
  const toAiming = (seed: string, overs = 5) => {
    const m = new Match(config({ home: side(team(0), 'human'), battingFirst: 'away', seed, overs }));
    while (m.phase !== 'chooseBowler') tick(m, dt);
    const pace = m.eligibleBowlers().find((p) => p.bowlingStyle === 'fast' || p.bowlingStyle === 'fastMedium');
    if (!pace) throw new Error('no pace bowler');
    m.chooseBowler(pace.id);
    return m;
  };

  it('goes delivery → landing spot → run-up, and the marker only moves while it is being placed', () => {
    const m = toAiming('steps');
    expect(m.aimStep).toBe('type');
    expect(m.availableDeliveries).toEqual(['fast', 'inswinger', 'outswinger', 'inCutter', 'outCutter', 'slower']);
    expect(m.selectDelivery('outCutter')).toBe(true);
    const before = { ...m.setup };
    m.adjustTarget(0.3, -1);
    expect(m.setup.line).toBe(before.line);
    m.bowlButton();
    expect(m.aimStep).toBe('target');
    m.adjustTarget(0.3, -1);
    expect(m.setup.line).toBeCloseTo(before.line + 0.3, 5);
    expect(m.setup.length).toBeCloseTo(before.length - 1, 5);
    m.aimBack();
    expect(m.aimStep).toBe('type');
    m.bowlButton();
    m.bowlButton();
    expect(m.phase).toBe('delivery');
    expect(m.cycle?.phase).toBe('runUp');
    expect(m.cycle?.plan.pitchLine).toBeCloseTo(m.setup.line, 5);
  });

  it('locks the pace from the meter during the run-up, and the amount can still change until release', () => {
    const m = toAiming('pace');
    m.selectDelivery('outswinger');
    m.bowlButton();
    m.bowlButton();
    while (m.meter < 0.7) m.step(dt);
    const meter = m.meter;
    m.adjustAmount(0.3);
    expect(m.lockPace()).toBe(true);
    expect(m.lockedPace).toBeCloseTo(meter, 5);
    expect(m.lockPace()).toBe(false);
    expect(m.cycle?.plan.amount).toBeCloseTo(0.8, 5);
    while (m.cycle?.phase === 'runUp') m.step(dt);
    expect(m.cycle?.delivery?.plan.effort).toBeCloseTo(meter, 5);
  });

  it('switches over and around the wicket, which moves the release point', () => {
    const m = toAiming('side');
    expect(m.setup.side).toBe('over');
    m.toggleSide();
    expect(m.setup.side).toBe('around');
    m.bowlButton();
    m.bowlButton();
    expect(m.lockPace()).toBe(true);
    while (m.cycle?.phase === 'runUp') m.step(dt);
    const x = m.cycle?.delivery?.release.x ?? 0;
    // Around the wicket a right-armer releases on the −x side, wide of the stumps.
    expect(m.bowler.bowlingArm === 'right' ? x < -0.4 : x > 0.4).toBe(true);
  });

  it('offers only two-out field presets in the powerplay, and uses the chosen one', () => {
    const m = toAiming('field', 20);
    const legal = m.availablePresets;
    expect(legal.length).toBeGreaterThanOrEqual(4);
    for (const p of legal) expect(p.positions.filter((x) => x.distance > 27.43).length).toBeLessThanOrEqual(2);
    expect(m.setFieldPreset('death-yorkers')).toBe(false);
    expect(m.setFieldPreset('pp-slips')).toBe(true);
    const ids = m.field.map((f) => f.position.id);
    expect(ids).toContain('slip2');
    expect(ids).toContain('thirdman');
  });
});

describe('squad drag and drop', () => {
  const xi = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  it('reorders, swaps a bench player in, and drops a player to the bench', () => {
    expect(applyDrop(xi, 'a', 'xi', { zone: 'xi', index: 3 }).slice(0, 4)).toEqual(['b', 'c', 'a', 'd']);
    expect(applyDrop(xi, 'd', 'xi', { zone: 'xi', index: 0 }).slice(0, 4)).toEqual(['d', 'a', 'b', 'c']);
    expect(applyDrop(xi, 'z', 'bench', { zone: 'xi', index: 2 })).toEqual(['a', 'b', 'z', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    const ten = applyDrop(xi, 'k', 'xi', { zone: 'bench' });
    expect(ten).toHaveLength(10);
    expect(applyDrop(ten, 'z', 'bench', { zone: 'xi', index: 10 })).toEqual([...xi.slice(0, 10), 'z']);
    expect(applyDrop(xi, 'z', 'bench', undefined)).toEqual(xi);
  });
});
