import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';
import { BOWLER_FOLLOW_THROUGH, STANDARD_FIELD } from '../data/fieldPositions.ts';
import { TEAMS } from '../data/teams.ts';
import { directionVector } from '../batting/contact.ts';
import type { Player } from '../model/player.ts';
import { createBall } from '../physics/ball.ts';
import { type Fielder, type FieldingPlan, RUN, buildField, planFielding, runTime, safeRuns } from './plan.ts';

const team = TEAMS[0];
if (!team) throw new Error('missing team');
const players = team.players;
const field = buildField(players, [...STANDARD_FIELD, BOWLER_FOLLOW_THROUGH], 'right');

/** A ball leaving the bat at the popping crease in a batter-relative direction. */
function hit(directionDeg: number, elevationDeg: number, speed: number, height = 0.4) {
  const d = directionVector(directionDeg, elevationDeg, 1);
  return createBall({ x: 0.1, y: height, z: STRIKER_STUMPS_Z - 1.6 }, { x: d.x * speed, y: d.y * speed, z: d.z * speed });
}

function plans(n: number, dir: number, elev: number, speed: number, f: readonly Fielder[] = field, height?: number): FieldingPlan[] {
  return Array.from({ length: n }, (_, i) => planFielding(hit(dir, elev, speed, height), f, new Rng(`f${i}`)));
}

const share = (xs: FieldingPlan[], kind: FieldingPlan['kind']) => xs.filter((p) => p.kind === kind).length / xs.length;

describe('planFielding', () => {
  it('a firm push straight at a ring fielder is stopped with no run', () => {
    const p = planFielding(hit(24, -10, 17), field, new Rng(1));
    expect(p.kind).toBe('fielded');
    expect(p.runs).toBe(0);
    expect(field[p.fielder ?? -1]?.position.id).toBe('midoff');
  });

  it('a soft push into space gets a quick single', () => {
    const p = planFielding(hit(47, -14, 13), field, new Rng(1));
    expect(p.kind).toBe('fielded');
    expect(p.runs).toBe(1);
  });

  it('a firmly driven ball through the off-side gap goes for four', () => {
    const xs = plans(30, 47, -4, 32);
    expect(share(xs, 'boundary')).toBeGreaterThan(0.7);
    expect(xs.every((p) => p.kind !== 'boundary' || p.runs === 4)).toBe(true);
  });

  it('the same drive hit straight at cover is stopped', () => {
    const p = planFielding(hit(70, -4, 30), field, new Rng(3));
    expect(p.kind).toBe('fielded');
    expect(p.runs).toBeLessThanOrEqual(1);
  });

  it('a big lofted hit clears the rope for six', () => {
    const p = planFielding(hit(-5, 33, 40), field, new Rng(4));
    expect(p.kind).toBe('boundary');
    expect(p.runs).toBe(6);
  });

  it('a mistimed lofted shot towards mid-on is usually caught', () => {
    const xs = plans(40, -24, 38, 19);
    expect(share(xs, 'caught')).toBeGreaterThan(0.6);
    expect(xs.filter((p) => p.kind === 'caught').every((p) => field[p.fielder ?? -1]?.position.id === 'midon')).toBe(true);
  });

  it('a thin edge carrying to the cordon is a chance for the keeper or slip', () => {
    const xs = plans(40, 165, 2, 26, field, 0.6);
    const chances = xs.filter((p) => p.kind === 'caught' || p.kind === 'dropped');
    expect(chances.length).toBeGreaterThan(25);
    expect(chances.every((p) => ['wk', 'slip1'].includes(field[p.fielder ?? -1]?.position.id ?? ''))).toBe(true);
  });

  it('better catchers hold more chances', () => {
    const withCatching = (v: number): Fielder[] =>
      field.map((f) => ({ ...f, player: { ...f.player, fielding: { ...f.player.fielding, catching: v } } satisfies Player }));
    const butter = share(plans(80, -24, 38, 21, withCatching(20)), 'caught');
    const safe = share(plans(80, -24, 38, 21, withCatching(95)), 'caught');
    expect(safe).toBeGreaterThan(butter + 0.15);
  });

  it('a ball worked into the leg-side gap gets the batters more than one', () => {
    const xs = plans(20, -130, -3, 21);
    expect(xs.every((p) => p.kind === 'fielded' && p.runs >= 1)).toBe(true);
    expect(xs.some((p) => p.runs >= 2)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    expect(planFielding(hit(30, 10, 25), field, new Rng('x'))).toEqual(planFielding(hit(30, 10, 25), field, new Rng('x')));
  });

  it('never lets the fielder arrive before they physically could', () => {
    for (const p of plans(40, 40, 15, 24)) {
      if (p.fielder === undefined) continue;
      const f = field[p.fielder];
      if (!f) throw new Error('bad index');
      const d = Math.hypot(p.interceptPos.x - f.start.x, p.interceptPos.z - f.start.z);
      expect(p.interceptT).toBeGreaterThanOrEqual((d - 1.8) / 8 - 1e-6);
    }
  });
});

describe('running between the wickets', () => {
  it('counts only runs completed with a safety margin', () => {
    expect(safeRuns(runTime(1) + 0.1)).toBe(0);
    expect(safeRuns(runTime(1) + 0.5)).toBe(1);
    expect(safeRuns(runTime(3) + 1)).toBe(3);
    expect(RUN.first).toBeGreaterThan(2.5);
  });

  it('boundary radius is respected by the geometry used here', () => {
    expect(FIELD.boundaryRadius).toBeGreaterThan(50);
  });
});
