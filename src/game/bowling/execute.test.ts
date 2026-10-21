import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { PITCHES, type PitchId } from '../data/pitches.ts';
import { findPlayer } from '../data/teams.ts';
import { SAMPLE_TEAMS as TEAMS } from '../data/sampleTeams.ts';
import type { Hand, Player } from '../model/player.ts';
import { NO_MOVEMENT } from '../physics/ball.ts';
import type { DeliveryTypeId } from './deliveryTypes.ts';
import { type DeliveryPlan, type ExecutedDelivery, executeDelivery } from './execute.ts';
import { sampleFlight, solveLaunch } from './solver.ts';

const mariners = TEAMS[0];
const rangers = TEAMS[1];
if (!mariners || !rangers) throw new Error('sample teams missing');

const quick = findPlayer(mariners, (p) => p.name === 'Sam Adeyemi'); // right-arm fast
const offie = findPlayer(mariners, (p) => p.name === 'Imran Qadir'); // right-arm off-spin
const leggie = findPlayer(rangers, (p) => p.name === 'Faisal Noor'); // right-arm leg-spin

const withAccuracy = (p: Player, accuracy: number): Player => ({ ...p, bowling: { ...p.bowling, accuracy } });

interface Opts {
  bowler?: Player;
  hand?: Hand;
  pitch?: PitchId;
  fatigue?: number;
  release?: number;
  seed?: string | number;
}

function bowl(plan: DeliveryPlan, o: Opts = {}): ExecutedDelivery {
  return executeDelivery(plan, {
    bowler: o.bowler ?? quick,
    batterHand: o.hand ?? 'right',
    pitch: PITCHES[o.pitch ?? 'balanced'],
    fatigue: o.fatigue ?? 0,
    releaseQuality: o.release ?? 1,
    rng: new Rng(o.seed ?? 'test'),
  });
}

function many(n: number, plan: DeliveryPlan, o: Opts = {}): ExecutedDelivery[] {
  return Array.from({ length: n }, (_, i) => bowl(plan, { ...o, seed: `${String(o.seed ?? 's')}-${i}` }));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const pitchLength = (d: ExecutedDelivery) => STRIKER_STUMPS_Z - (d.actual.pitch?.z ?? STRIKER_STUMPS_Z);

describe('launch solver', () => {
  it('lands the ball where asked, with drag and swing included', () => {
    for (const [speed, swing, z] of [[38, 0, 4], [34, 4, 2], [22, 0, 6], [40, -3, -1]] as const) {
      const release = { x: 0.22, y: 2.15, z: -9 };
      const movement = { ...NO_MOVEMENT, swingAccel: swing };
      const v = solveLaunch(release, { x: 0.1, z }, speed, movement);
      const s = sampleFlight(release, v, movement);
      expect(Math.abs((s.pitch?.x ?? 99) - 0.1)).toBeLessThan(0.02);
      expect(Math.abs((s.pitch?.z ?? 99) - z)).toBeLessThan(0.03);
    }
  });
});

describe('executeDelivery', () => {
  it('is deterministic for a given seed', () => {
    const plan: DeliveryPlan = { type: 'outswinger', line: 0.15, length: 5 };
    expect(bowl(plan, { seed: 7 })).toEqual(bowl(plan, { seed: 7 }));
  });

  it('an accurate bowler with a clean release lands close to the plan', () => {
    const ds = many(60, { type: 'fast', line: 0.1, length: 5.5 }, { bowler: withAccuracy(quick, 95) });
    expect(Math.abs(mean(ds.map(pitchLength)) - 5.5)).toBeLessThan(0.25);
    expect(sd(ds.map(pitchLength))).toBeLessThan(0.45);
  });

  it('lower accuracy, poor release and fatigue each widen the spread', () => {
    const plan: DeliveryPlan = { type: 'fast', line: 0.1, length: 5.5 };
    const base = sd(many(80, plan, { bowler: withAccuracy(quick, 90) }).map(pitchLength));
    const wild = sd(many(80, plan, { bowler: withAccuracy(quick, 40) }).map(pitchLength));
    const poorRelease = sd(many(80, plan, { bowler: withAccuracy(quick, 90), release: 0.2 }).map(pitchLength));
    const tired = sd(many(80, plan, { bowler: withAccuracy(quick, 90), fatigue: 1 }).map(pitchLength));
    expect(wild).toBeGreaterThan(base * 1.4);
    expect(poorRelease).toBeGreaterThan(base * 1.4);
    expect(tired).toBeGreaterThan(base * 1.3);
  });

  it('fatigue costs pace', () => {
    const fresh = mean(many(30, { type: 'fast', line: 0, length: 5 }).map((d) => d.releaseSpeedKph));
    const tired = mean(many(30, { type: 'fast', line: 0, length: 5 }, { fatigue: 1 }).map((d) => d.releaseSpeedKph));
    expect(tired).toBeLessThan(fresh - 4);
  });

  it('refuses deliveries outside the bowler’s repertoire', () => {
    expect(() => bowl({ type: 'doosra', line: 0, length: 5 })).toThrow();
    expect(() => bowl({ type: 'bouncer', line: 0, length: 10 }, { bowler: offie })).toThrow();
  });
});

describe('delivery types behave differently', () => {
  const avg = (type: DeliveryTypeId, f: (d: ExecutedDelivery) => number, o: Opts = {}, line = 0.05, length = 5) =>
    mean(many(40, { type, line, length }, o).map(f));

  it('a slower ball is markedly slower than the stock ball', () => {
    expect(avg('slower', (d) => d.releaseSpeedKph)).toBeLessThan(avg('fast', (d) => d.releaseSpeedKph) * 0.85);
  });

  it('a yorker pitches near the crease and a bouncer is head-high at the stumps', () => {
    expect(avg('yorker', pitchLength)).toBeLessThan(1.6);
    const bouncerHeight = avg('bouncer', (d) => d.actual.atStumps?.y ?? 0, {}, 0, 10.5);
    const goodHeight = avg('fast', (d) => d.actual.atStumps?.y ?? 0, {}, 0, 5.5);
    expect(bouncerHeight).toBeGreaterThan(1.3);
    expect(bouncerHeight).toBeGreaterThan(goodHeight + 0.5);
  });

  it('a full toss does not pitch before reaching the batter', () => {
    const ds = many(30, { type: 'fullToss', line: 0, length: 0 });
    const pitchedEarly = ds.filter((d) => d.actual.pitch && d.actual.pitch.z < STRIKER_STUMPS_Z - FIELD.poppingCreaseOffset);
    expect(pitchedEarly.length).toBeLessThan(3);
  });

  it('in- and out-swingers move opposite ways relative to the batter, mirrored for a left-hander', () => {
    const swing = (type: DeliveryTypeId, hand: Hand) => avg(type, (d) => d.movement.swingAccel, { hand });
    expect(swing('outswinger', 'right')).toBeGreaterThan(1);
    expect(swing('inswinger', 'right')).toBeLessThan(-1);
    expect(swing('outswinger', 'left')).toBeLessThan(-1);
  });

  it('off-break and leg-break turn opposite ways; the doosra turns against the off-break', () => {
    // Lateral movement after pitching, in world x.
    const turn = (type: DeliveryTypeId, bowler: Player) =>
      avg(type, (d) => (d.actual.atStumps?.x ?? 0) - (d.actual.pitch?.x ?? 0), { bowler, pitch: 'dry' });
    const offBreak = turn('offBreak', offie);
    const doosra = turn('doosra', offie);
    const legBreak = turn('legBreak', leggie);
    expect(offBreak).toBeLessThan(-0.1);
    expect(doosra).toBeGreaterThan(0.05);
    expect(legBreak).toBeGreaterThan(0.1);
  });

  it('a dry pitch turns more than a flat one', () => {
    const turn = (pitch: PitchId) =>
      Math.abs(avg('offBreak', (d) => (d.actual.atStumps?.x ?? 0) - (d.actual.pitch?.x ?? 0), { bowler: offie, pitch }));
    expect(turn('dry')).toBeGreaterThan(turn('flat') * 1.6);
  });

  it('the top-spinner bounces higher than the off-break from the same length', () => {
    const h = (type: DeliveryTypeId) => avg(type, (d) => d.actual.atStumps?.y ?? 0, { bowler: offie }, 0, 4);
    expect(h('topSpinner')).toBeGreaterThan(h('offBreak') + 0.05);
  });

  it('the aimed line holds despite planned turn (bowlers allow for their spin)', () => {
    const line = avg('legBreak', (d) => d.actual.atStumps?.x ?? 0, { bowler: withAccuracy(leggie, 95) }, 0.1, 5);
    expect(Math.abs(line - 0.1)).toBeLessThan(0.12);
  });
});
