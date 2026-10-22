import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import { type LbwTracking, buildTracking, review, umpireDecision, verdict, zones } from './tracking.ts';

const track = (o: { pitchX?: number; impactX?: number; atX?: number; atY?: number; distance?: number; shot?: boolean; off?: 1 | -1 }): LbwTracking =>
  buildTracking({
    path: [],
    projection: [],
    pitch: o.pitchX === undefined ? { x: 0, z: 4 } : { x: o.pitchX, z: 4 },
    impact: { x: o.impactX ?? 0, y: 0.3, z: STRIKER_STUMPS_Z - (o.distance ?? 2) },
    atStumps: { x: o.atX ?? 0, y: o.atY ?? 0.4 },
    off: o.off ?? 1,
    shotOffered: o.shot ?? true,
    stumpsZ: STRIKER_STUMPS_Z,
  });

describe('ball tracking zones', () => {
  it('pitching outside leg, impact outside the line with a shot, or missing: not out', () => {
    expect(verdict(track({ pitchX: -0.3 }))).toBe('notOut');
    expect(verdict(track({ impactX: 0.3, shot: true }))).toBe('notOut');
    // Outside off with no shot offered can still be out.
    expect(verdict(track({ impactX: 0.3, shot: false }))).toBe('out');
    expect(verdict(track({ atX: 0.3 }))).toBe('notOut');
    expect(verdict(track({ atY: 0.9 }))).toBe('notOut');
  });

  it("less than half the ball hitting (or in line) is umpire's call; so is a long projection", () => {
    expect(track({ atX: 0.13 }).wickets).toBe('umpiresCall');
    expect(track({ atX: 0.1 }).wickets).toBe('hitting');
    expect(track({ atY: 0.73 }).wickets).toBe('umpiresCall');
    expect(track({ impactX: 0.13 }).impactZone).toBe('umpiresCall');
    expect(track({ distance: 3.2 }).wickets).toBe('umpiresCall');
    expect(verdict(track({ atX: 0.13 }))).toBe('umpiresCall');
  });

  it('the off side flips for a left-hander', () => {
    expect(zones(0.3, 0, { x: 0, y: 0.4 }, -1, true, 2).pitching).toBe('outsideLeg');
    expect(zones(-0.3, 0, { x: 0, y: 0.4 }, -1, true, 2).pitching).toBe('outsideOff');
  });
});

describe('reviews', () => {
  it('overturn only on clear tracking; umpire\'s call keeps the decision and the review', () => {
    expect(review('notOut', track({}))).toEqual({ decision: 'out', overturned: true, retained: true, umpiresCall: false });
    expect(review('out', track({ atX: 0.3 }))).toEqual({ decision: 'notOut', overturned: true, retained: true, umpiresCall: false });
    expect(review('out', track({ atX: 0.13 }))).toEqual({ decision: 'out', overturned: false, retained: true, umpiresCall: true });
    expect(review('notOut', track({ atX: 0.13 })).decision).toBe('notOut');
    // The decision was right: the review is lost.
    expect(review('out', track({}))).toEqual({ decision: 'out', overturned: false, retained: false, umpiresCall: false });
  });

  it('the umpire gets plumb ones right and the close ones sometimes wrong', () => {
    const rng = new Rng('ump');
    const plumb = track({ atX: 0.0, distance: 1 });
    const close = track({ atX: 0.12, distance: 2.5 });
    const outs = (t: LbwTracking) => Array.from({ length: 400 }, () => umpireDecision(t, rng).decision === 'out').filter(Boolean).length / 400;
    expect(outs(plumb)).toBeGreaterThan(0.95);
    const c = outs(close);
    expect(c).toBeGreaterThan(0.15);
    expect(c).toBeLessThan(0.85);
    expect(outs(track({ atX: 0.4 }))).toBeLessThan(0.02);
  });
});
