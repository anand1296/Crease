import { describe, expect, it } from 'vitest';
import { PITCHES } from './pitches.ts';
import { VENUES, VENUE_IDS, standsOuterRadius } from './venues.ts';
import { WEATHER_IDS, pitchInConditions } from './weather.ts';
import { FIELD } from './field.ts';

describe('conditions', () => {
  const base = PITCHES.balanced;

  it('cloud helps the ball swing and seam; sun dries the pitch for the spinners', () => {
    const overcast = pitchInConditions(base, 'overcast', 0);
    const sunny = pitchInConditions(base, 'sunny', 0);
    expect(overcast.swingConditions).toBeGreaterThan(sunny.swingConditions);
    expect(overcast.surface.seam).toBeGreaterThan(sunny.surface.seam);
    expect(sunny.surface.grip).toBeGreaterThan(overcast.surface.grip);
  });

  it('under lights the dew comes in the second innings: the spinners lose their grip and the ball skids on', () => {
    const first = pitchInConditions(base, 'lights', 0);
    const second = pitchInConditions(base, 'lights', 1);
    expect(second.surface.grip).toBeLessThan(first.surface.grip * 0.8);
    expect(second.surface.friction).toBeLessThan(first.surface.friction);
    // No dew in the day.
    expect(pitchInConditions(base, 'sunny', 1)).toEqual(pitchInConditions(base, 'sunny', 0));
  });

  it('never changes the pitch itself', () => {
    for (const w of WEATHER_IDS) pitchInConditions(base, w, 1);
    expect(base).toEqual(PITCHES.balanced);
  });
});

describe('venues', () => {
  it('every ground keeps its stands behind the boundary boards', () => {
    for (const id of VENUE_IDS) {
      const v = VENUES[id];
      for (const t of v.tiers) expect(t.r).toBeGreaterThan(FIELD.boundaryRadius + 4);
      expect(standsOuterRadius(v)).toBeLessThan(140);
      expect(v.lights.r).toBeGreaterThan(FIELD.boundaryRadius + 10);
    }
  });
});
