import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { TEAMS, findPlayer, findTeam } from '../data/teams.ts';
import { DIFFICULTIES } from '../model/difficulty.ts';
import { AdaptiveBowling, ballReward } from './adaptiveBowling.ts';
import { deepGaps } from './battingAi.ts';
import { fieldingPhase, maxOutside, setField } from './captain.ts';
import { type BallRecord, battingNotes, bowlingNotes } from './coach.ts';
import { Commentator, region } from './commentary.ts';

const india = findTeam('india');
const england = findTeam('england');
const quick = findPlayer(india, (p) => p.name === 'Mayank Yadav');
const batter = findPlayer(england, (p) => p.name === 'Harry Brook');

describe('adaptive bowling (Thompson sampling)', () => {
  it('learns to bowl what the batter cannot score from, and drops what he hits', () => {
    const brain = new AdaptiveBowling();
    const rng = new Rng('learn');
    const plans = brain.plansFor(quick).map((p) => p.id);
    expect(plans).toContain('yorker');
    expect(plans).toContain('bouncer');
    // This batter: smashes everything except the bouncer, which gets him out.
    const outcome = (planId: string) => (planId === 'bouncer' ? ballReward({ runs: 0, extras: 0, wicket: rng.chance(0.25), beaten: true }) : ballReward({ runs: rng.chance(0.5) ? 4 : 1, extras: 0, wicket: false, beaten: false }));
    const firstTen: string[] = [];
    const lastFifty: string[] = [];
    for (let i = 0; i < 120; i++) {
      const d = brain.choose(quick, batter, 1, DIFFICULTIES.hard, rng);
      if (i < 10) firstTen.push(d.planId);
      if (i >= 70) lastFifty.push(d.planId);
      brain.learn(batter.id, d.planId, outcome(d.planId));
    }
    const share = (list: string[]) => list.filter((p) => p === 'bouncer').length / list.length;
    expect(share(lastFifty)).toBeGreaterThan(0.6);
    expect(share(lastFifty)).toBeGreaterThan(share(firstTen));
    // And it can say why.
    const d = brain.choose(quick, batter, 1, DIFFICULTIES.hard, rng);
    if (d.planId === 'bouncer') expect(d.insight).toMatch(/bouncer/);
  });

  it('knows the phase before it knows the batter: more yorkers at the death', () => {
    const count = (phase: 0 | 1 | 2) => {
      const brain = new AdaptiveBowling();
      const rng = new Rng(`phase-${phase}`);
      let yorkers = 0;
      for (let i = 0; i < 300; i++) if (brain.choose(quick, batter, phase, DIFFICULTIES.normal, rng).planId.includes('yorker')) yorkers += 1;
      return yorkers;
    };
    expect(count(2)).toBeGreaterThan(count(0) * 1.5);
  });

  it('pools what it learns across the human line-up', () => {
    const brain = new AdaptiveBowling();
    const other = findPlayer(england, (p) => p.name === 'Phil Salt');
    const plan = brain.plansFor(quick).find((p) => p.id === 'slower-full');
    if (!plan) throw new Error('plan');
    const before = brain.belief(other.id, plan, 1).mean;
    for (let i = 0; i < 10; i++) brain.learn(batter.id, 'slower-full', 6);
    expect(brain.belief(other.id, plan, 1).mean).toBeGreaterThan(before);
    expect(brain.belief(batter.id, plan, 1).mean).toBeGreaterThan(brain.belief(other.id, plan, 1).mean);
  });
});

describe('AI captain', () => {
  it('obeys fielding restrictions: two out in the powerplay, four in the middle, five at the death', () => {
    expect(fieldingPhase(20, 0)).toBe('powerplay');
    expect(fieldingPhase(20, 6 * 6)).toBe('middle');
    expect(fieldingPhase(20, 17 * 6)).toBe('death');
    for (const [balls, phase] of [[0, 'powerplay'], [60, 'middle'], [110, 'death']] as const) {
      const f = setField({ overs: 20, ballsBowled: balls, spinner: false, wagon: [] });
      expect(f.positions).toHaveLength(9);
      expect(f.phase).toBe(phase);
      expect(f.positions.filter((p) => p.distance > 27.43).length).toBeLessThanOrEqual(maxOutside(phase));
    }
  });

  it('attacks with slips for the new ball and moves fielders to where the batter scores', () => {
    const newBall = setField({ overs: 20, ballsBowled: 0, spinner: false, wagon: [] });
    expect(newBall.positions.some((p) => p.id === 'slip1')).toBe(true);
    const legSideHitter = setField({
      overs: 20,
      ballsBowled: 60,
      spinner: false,
      wagon: Array.from({ length: 6 }, () => ({ directionDeg: -60, runs: 6 })),
    });
    expect(legSideHitter.positions.some((p) => p.id === 'deepmid')).toBe(true);
    expect(legSideHitter.protecting).toBe('midwicket');
    const offSideHitter = setField({ overs: 20, ballsBowled: 60, spinner: false, wagon: Array.from({ length: 6 }, () => ({ directionDeg: 62, runs: 4 })) });
    expect(offSideHitter.positions.some((p) => p.id === 'deepcover')).toBe(true);
  });

  it('the batting AI aims lofted shots at the gaps in the deep', () => {
    const g = deepGaps([16, -16, -58, -100, 62]);
    // Leg side: fielders at -16, -58, -100 — the widest gap is behind square (~ -110) or between (~ -37/-79).
    expect([-16, -58, -100].every((a) => Math.abs(g.leg - a) >= 18)).toBe(true);
    expect([16, 62].every((a) => Math.abs(g.off - a) >= 20)).toBe(true);
  });
});

describe('commentary', () => {
  const base = {
    bowler: 'Mayank Yadav',
    batter: 'Harry Brook',
    delivery: { name: 'Stock ball', speedKph: 149, line: 0.1, length: 5 },
    pace: true,
    runs: 0,
    extras: 0,
    wide: false,
    noBall: false,
    batterRuns: 0,
    batterBalls: 1,
    bowlerWickets: 0,
    total: { runs: 0, wickets: 0 },
    overComplete: false,
    overRuns: 0,
  };

  it('describes where the ball went', () => {
    expect(region(0, true)).toMatch(/straight/);
    expect(region(60, false)).toBe('through the covers');
    expect(region(-60, true)).toBe('over deep midwicket');
    expect(region(140, false)).toBe('down to third man');
  });

  it('calls a six, a wicket with the fielder, a milestone and the chase', () => {
    const c = new Commentator('t');
    const six = c.ball({ ...base, runs: 6, boundary: 6, shot: 'Lofted shot', contact: 'middled', directionDeg: -20, elevationDeg: 30, batterRuns: 52, batterBalls: 30 });
    expect(six.text).toMatch(/^Yadav to Brook\./);
    expect(six.text.toLowerCase()).toMatch(/six/);
    expect(six.text).toMatch(/fifty for Brook, off 30 balls/);
    expect(six.excitement).toBe(2);
    const out = c.ball({ ...base, contact: 'middled', shot: 'Pull', directionDeg: -70, elevationDeg: 25, wicket: { kind: 'caught', fielder: 'Tilak Varma', out: 'Harry Brook' }, outBatterRuns: 52, bowlerWickets: 3 });
    expect(out.text).toMatch(/Varma/);
    expect(out.text).toMatch(/Brook goes for 52/);
    expect(out.text).toMatch(/3 for Yadav/);
    const over = c.ball({ ...base, runs: 1, shot: 'Defensive block', contact: 'middled', directionDeg: 30, overComplete: true, overRuns: 9, chase: { team: 'England', needed: 30, balls: 18 } });
    expect(over.text).toMatch(/9 from the over\. England need 30 from 18 balls\./);
  });

  it('never repeats the same phrasing twice running', () => {
    const c = new Commentator('r');
    let last = '';
    for (let i = 0; i < 20; i++) {
      const t = c.ball({ ...base, runs: 4, boundary: 4, shot: 'Cover drive', contact: 'middled', directionDeg: 60 }).text;
      expect(t).not.toBe(last);
      last = t;
    }
  });
});

describe('coach', () => {
  const rec = (over: Partial<BallRecord>): BallRecord => ({
    innings: 0,
    humanBatting: true,
    humanBowling: false,
    deliveryType: 'fast',
    deliveryName: 'Stock ball',
    speedKph: 140,
    length: 5,
    shot: 'coverDrive',
    shotName: 'Cover drive',
    footwork: 'front',
    contact: 'middled',
    timingMs: 0,
    runs: 1,
    extras: 0,
    wide: false,
    noBall: false,
    wicket: undefined,
    legal: true,
    ...over,
  });

  it('spots consistently early timing and the delivery that keeps getting you out', () => {
    const log = [
      ...Array.from({ length: 6 }, () => rec({ timingMs: -40 })),
      ...Array.from({ length: 4 }, (_, i) => rec({ deliveryType: 'yorker', deliveryName: 'Yorker', length: 0.9, timingMs: -35, runs: 0, contact: 'miss', wicket: i === 0 ? 'bowled' : undefined })),
    ];
    const notes = battingNotes(log);
    expect(notes[0]?.title).toMatch(/early — by about 3\d ms/);
    expect(notes.some((n) => /nemesis: the yorker/.test(n.title) && /block it \(S\)/.test(n.detail))).toBe(true);
  });

  it('tells a bowler which ball works and which is being punished', () => {
    const b = (name: string, runs: number, wicket?: 'bowled') => rec({ humanBatting: false, humanBowling: true, deliveryName: name, runs, wicket });
    const log = [...Array.from({ length: 6 }, () => b('Yorker', 1)), b('Yorker', 0, 'bowled'), ...Array.from({ length: 6 }, () => b('Bouncer', 3)), rec({ humanBatting: false, humanBowling: true, wide: true, legal: false, extras: 1, runs: 0 }), rec({ humanBatting: false, humanBowling: true, wide: true, legal: false, extras: 1, runs: 0 })];
    const notes = bowlingNotes(log);
    expect(notes[0]?.title).toBe('Your best ball: the yorker');
    expect(notes.some((n) => /bouncer is being punished/.test(n.title))).toBe(true);
    expect(notes.some((n) => n.title === '2 wides')).toBe(true);
  });

  it('says nothing until it has seen enough', () => {
    expect(battingNotes([rec({})])).toEqual([]);
    expect(TEAMS.length).toBe(4);
  });
});
