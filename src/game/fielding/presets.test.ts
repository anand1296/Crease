import { describe, expect, it } from 'vitest';
import { maxOutside } from '../ai/captain.ts';
import { CIRCLE, FIELD_PRESETS, legalPresets, outsideCircle } from './presets.ts';

describe('field presets', () => {
  it('has ten presets of nine distinct positions, attacking to defensive', () => {
    expect(FIELD_PRESETS).toHaveLength(10);
    for (const p of FIELD_PRESETS) {
      expect(p.positions).toHaveLength(9);
      expect(new Set(p.positions.map((x) => x.id)).size).toBe(9);
      // Everyone inside the boundary (65 m) and off the pitch.
      for (const pos of p.positions) expect(pos.distance).toBeLessThan(65);
    }
    expect(new Set(FIELD_PRESETS.map((p) => p.mood))).toEqual(new Set(['aggressive', 'moderate', 'defensive']));
  });

  it('respects the fielding restrictions: two out in the powerplay, five after it in T20', () => {
    const pp = legalPresets(maxOutside('powerplay', 20));
    expect(pp.length).toBeGreaterThanOrEqual(4);
    for (const p of pp) expect(outsideCircle(p)).toBeLessThanOrEqual(2);
    expect(legalPresets(maxOutside('middle', 20))).toHaveLength(10);
    for (const p of FIELD_PRESETS) expect(outsideCircle(p)).toBeLessThanOrEqual(5);
    expect(CIRCLE).toBeCloseTo(27.43, 2);
  });
});

describe('changing the field', () => {
  it('moves each fielder to the nearest new position rather than across the ground', async () => {
    const { buildField, rebuildField } = await import('./plan.ts');
    const { SAMPLE_TEAMS } = await import('../data/sampleTeams.ts');
    const players = (SAMPLE_TEAMS[0]?.players ?? []).slice(0, 9);
    const from = FIELD_PRESETS.find((p) => p.id === 'pp-standard');
    const to = FIELD_PRESETS.find((p) => p.id === 'riders');
    if (!from || !to) throw new Error('presets missing');
    const before = buildField(players, from.positions, 'right');
    const spots = new Map(before.map((f) => [f.player.id, f.start]));
    const moved = (field: ReturnType<typeof buildField>) =>
      field.reduce((sum, f) => {
        const s = spots.get(f.player.id);
        return sum + (s ? Math.hypot(s.x - f.start.x, s.z - f.start.z) : 0);
      }, 0);
    const naive = moved(buildField(players, to.positions, 'right'));
    const captain = moved(rebuildField(players, to.positions, 'right', spots));
    expect(captain).toBeLessThan(naive * 0.75);
    // Every position is filled exactly once.
    const rebuilt = rebuildField(players, to.positions, 'right', spots);
    expect(new Set(rebuilt.map((f) => f.position.id)).size).toBe(9);
    expect(new Set(rebuilt.map((f) => f.player.id)).size).toBe(9);
  });
});

describe('hungarian assignment', () => {
  it('finds the cheapest assignment', async () => {
    const { hungarian } = await import('./plan.ts');
    expect(hungarian([[4, 1, 3], [2, 0, 5], [3, 2, 2]])).toEqual([1, 0, 2]);
    // Greedy would take (0,0)=1 then be forced into (1,1)=100; optimal is 2+2.
    expect(hungarian([[1, 2], [2, 100]])).toEqual([1, 0]);
  });
});
