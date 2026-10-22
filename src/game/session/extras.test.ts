import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { PITCHES } from '../data/pitches.ts';
import { STANDARD_FIELD } from '../data/fieldPositions.ts';
import { TEAMS } from '../data/teams.ts';
import { attempt } from '../batting/shots.ts';
import { buildField } from '../fielding/plan.ts';
import { defaultXi } from '../match/squad.ts';
import { type BallOutcome, type CycleOptions, DeliveryCycle } from './deliveryCycle.ts';

const bat = TEAMS[0];
const bowl = TEAMS[1];
if (!bat || !bowl) throw new Error('teams');
const batters = defaultXi(bat);
const fielders = defaultXi(bowl);
const must = <T,>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};
const striker = must(batters[0]);
const bowler = must(fielders.find((p) => p.bowlingStyle === 'fast') ?? fielders[10]);

function cycle(seed: string, o: Partial<CycleOptions> = {}): DeliveryCycle {
  const keeperFirst = [fielders.find((p) => p.id === bowl?.keeperIds[0]) ?? fielders[0], ...fielders.filter((p) => p.id !== bowl?.keeperIds[0])].filter((p) => p !== undefined);
  return new DeliveryCycle({
    bowler,
    striker,
    nonStriker: must(batters[1]),
    field: buildField(keeperFirst, STANDARD_FIELD, striker.battingHand),
    pitch: PITCHES.balanced,
    plan: { type: 'fast', line: 0.1, length: 6 },
    fatigue: 0,
    rng: new Rng(seed),
    releaseQuality: 1,
    ...o,
  });
}

function ball(seed: string, o: Partial<CycleOptions> & { shotAt?: number; shot?: Parameters<typeof attempt>[0] } = {}): BallOutcome {
  const keeperFirst = [fielders.find((p) => p.id === bowl?.keeperIds[0]) ?? fielders[0], ...fielders.filter((p) => p.id !== bowl?.keeperIds[0])].filter((p) => p !== undefined);
  const c = new DeliveryCycle({
    bowler,
    striker,
    nonStriker: must(batters[1]),
    field: buildField(keeperFirst, STANDARD_FIELD, striker.battingHand),
    pitch: PITCHES.balanced,
    plan: { type: 'fast', line: -0.05, length: 6.5 },
    fatigue: 0,
    rng: new Rng(seed),
    releaseQuality: 1,
    ...o,
  });
  let shot = false;
  for (let i = 0; i < 240 * 30 && !c.finished; i++) {
    c.step(1 / 240);
    if (!shot && o.shot && c.phase === 'inFlight' && c.flightTime >= (o.shotAt ?? 0.05)) shot = c.playShot(attempt(o.shot, 'front'));
  }
  if (!c.outcome) throw new Error('no outcome');
  return c.outcome;
}

describe('extras: leg byes, byes, free hits', () => {
  it('balls off the pad run on, and leg byes come when a stroke was offered', () => {
    let legByes = 0;
    let padded = 0;
    for (let i = 0; i < 160; i++) {
      // A flick played far too early, at a ball on the pads.
      const o = ball(`lb-${i}`, { shot: 'flick', shotAt: 0.02, plan: { type: 'inswinger', line: -0.12, length: 5 } });
      if (o.legByes) legByes += 1;
      if (o.headline.includes('leg bye') || o.appeal || o.legByes) padded += 1;
      // Leg byes never go to the batter or the bowler's runs.
      if (o.legByes) expect(o.runs).toBe(0);
    }
    expect(padded).toBeGreaterThan(5);
    expect(legByes).toBeGreaterThan(0);
  });

  it('no stroke, no leg byes: the runs do not count', () => {
    for (let i = 0; i < 120; i++) {
      const o = ball(`nolb-${i}`, { plan: { type: 'inswinger', line: -0.15, length: 5 } });
      expect(o.legByes ?? 0).toBe(0);
    }
  });

  it('a free hit cannot be lost to anything but a run-out', () => {
    for (let i = 0; i < 80; i++) {
      const o = ball(`fh-${i}`, { freeHit: true, plan: { type: 'fast', line: 0, length: 3 } });
      if (o.wicket) expect(o.wicket.kind).toBe('runOut');
      expect(o.freeHit).toBe(true);
    }
  });

  it('the second bouncer of an over is a no-ball', () => {
    let bouncers = 0;
    for (let i = 0; i < 30; i++) {
      const o = ball(`bou-${i}`, { bouncersThisOver: 1, plan: { type: 'bouncer', line: 0, length: 11 } });
      if (o.bouncer) {
        bouncers += 1;
        expect(o.noBall).toBe(true);
        expect(o.extras).toBeGreaterThanOrEqual(1);
      }
    }
    expect(bouncers).toBeGreaterThan(10);
  });

  it('a wild throw that nobody backs up runs away for overthrows', () => {
    let overthrows = 0;
    for (let i = 0; i < 300; i++) {
      const c = cycle(`ot-${i}`, { manualRunning: true, humanFielding: true, plan: { type: 'fast', line: 0.35, length: 3.5 } });
      let shot = false;
      let called = 0;
      for (let k = 0; k < 240 * 30 && !c.finished; k++) {
        c.step(1 / 240);
        // Press times spread around the arrival, so plenty of the strokes connect.
        if (!shot && c.phase === 'inFlight' && c.flightTime > 0.12 + (i % 12) * 0.03) shot = c.playShot(attempt('coverDrive', 'front'));
        if (c.phase === 'struck' && called < 1) {
          c.callRun();
          called += 1;
        }
        // Forced, wild throws.
        if (c.awaitingThrowSince !== undefined) c.throwBall('bowler', 1.2);
        // It has gone past the stumps: they take another.
        if (c.overthrow && called < 2 && c.time > c.overthrow.at + 0.2) {
          c.callRun();
          called += 1;
        }
      }
      overthrows += c.outcome?.overthrows ?? 0;
    }
    expect(overthrows).toBeGreaterThan(0);
  });

  it('a run called off in time costs nothing; called off too late, he is run out', () => {
    let saved = 0;
    for (let i = 0; i < 60; i++) {
      const c = cycle(`back-${i}`, { manualRunning: true });
      let shot = false;
      let called = false;
      let sent = false;
      for (let k = 0; k < 240 * 30 && !c.finished; k++) {
        c.step(1 / 240);
        if (!shot && c.phase === 'inFlight' && c.flightTime > 0.1) shot = c.playShot(attempt('block', 'front'));
        if (c.phase === 'struck' && !called) called = c.callRun();
        // A stride or two down the pitch: "No! Go back!"
        const p = c.runProgress();
        if (called && !sent && p.current !== undefined && p.current > 0.15) sent = c.sendBack();
      }
      if (sent && c.outcome && !c.outcome.wicket) {
        saved += 1;
        expect(c.outcome.runs).toBe(0);
      }
    }
    expect(saved).toBeGreaterThan(0);
  });
});
