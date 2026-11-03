import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { PITCHES } from '../data/pitches.ts';
import { STANDARD_FIELD } from '../data/fieldPositions.ts';
import { TEAMS } from '../data/teams.ts';
import { attempt } from '../batting/shots.ts';
import { buildField } from '../fielding/plan.ts';
import { defaultXi } from '../match/squad.ts';
import { type CycleOptions, DIVE_GAIN, DeliveryCycle } from './deliveryCycle.ts';

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
    plan: { type: 'fast', line: 0.3, length: 3.5 },
    fatigue: 0,
    rng: new Rng(seed),
    releaseQuality: 1,
    manualRunning: true,
    ...o,
  });
}

/** Plays a cover drive and calls one run; returns the cycle as soon as the run is under way. */
function struckAndRunning(seed: string, o: Partial<CycleOptions> = {}): DeliveryCycle | undefined {
  const c = cycle(seed, o);
  let shot = false;
  for (let k = 0; k < 240 * 20 && !c.finished; k++) {
    c.step(1 / 240);
    if (!shot && c.phase === 'inFlight' && c.flightTime > 0.18) shot = c.playShot(attempt('coverDrive', 'front'));
    if (c.phase === 'struck' && c.runStarts.length === 0) c.callRun();
    const p = c.runProgress();
    if (c.phase === 'struck' && p.current !== undefined && p.current > 0.1) return c;
  }
  return undefined;
}

const endOfRun = (c: DeliveryCycle) => {
  let t = c.time;
  while (c.runProgress(t).completed < 1 && t < c.time + 10) t += 0.01;
  return t;
};

describe('running between the wickets: sprinting and diving', () => {
  it('a sprint gets him to the other end sooner, without jumping him along the pitch', () => {
    let tried = 0;
    for (let i = 0; i < 30 && tried < 5; i++) {
      const c = struckAndRunning(`sprint-${i}`);
      if (!c) continue;
      tried += 1;
      const before = endOfRun(c);
      const at = c.runProgress().current ?? 0;
      expect(c.sprint(true)).toBe(true);
      expect(c.runProgress().current ?? 0).toBeCloseTo(at, 5);
      expect(endOfRun(c)).toBeLessThan(before - 0.15);
      // Once is enough for that run.
      expect(c.sprint(true)).toBe(false);
    }
    expect(tried).toBeGreaterThan(2);
  });

  it('no sprint left when he is out on his feet', () => {
    for (let i = 0; i < 30; i++) {
      const c = struckAndRunning(`tired-${i}`, { form: { confidence: 0.5, strikerFatigue: 0.9, nonStrikerFatigue: 0.4 } });
      if (!c) continue;
      expect(c.sprint(true)).toBe(false);
      return;
    }
    throw new Error('no run');
  });

  it('a dive at the end of a run gets him in a fifth of a second sooner; not from halfway', () => {
    let tried = 0;
    for (let i = 0; i < 30 && tried < 5; i++) {
      const c = struckAndRunning(`dive-${i}`);
      if (!c) continue;
      tried += 1;
      expect(c.dive()).toBe(false);
      while ((c.runProgress().current ?? 1) < 0.7 && c.phase === 'struck') c.step(1 / 240);
      if (c.phase !== 'struck') continue;
      const before = endOfRun(c);
      expect(c.dive()).toBe(true);
      expect(endOfRun(c)).toBeCloseTo(before - DIVE_GAIN, 1);
      expect(c.dives).toHaveLength(1);
    }
    expect(tried).toBeGreaterThan(2);
  });
});
