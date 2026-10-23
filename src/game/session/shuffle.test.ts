import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng.ts';
import { PITCHES } from '../data/pitches.ts';
import { STANDARD_FIELD } from '../data/fieldPositions.ts';
import { TEAMS } from '../data/teams.ts';
import { batterBoxes } from '../batting/body.ts';
import { attempt } from '../batting/shots.ts';
import { buildField } from '../fielding/plan.ts';
import { defaultXi } from '../match/squad.ts';
import { DeliveryCycle, SHUFFLE_LEG, SHUFFLE_OFF } from './deliveryCycle.ts';

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

function cycle(seed: string, line = 0.1): DeliveryCycle {
  return new DeliveryCycle({
    bowler,
    striker,
    nonStriker: must(batters[1]),
    field: buildField(fielders, STANDARD_FIELD, striker.battingHand),
    pitch: PITCHES.balanced,
    plan: { type: 'fast', line, length: 6 },
    fatigue: 0,
    rng: new Rng(seed),
    releaseQuality: 1,
  });
}

describe('moving across the crease before the ball is bowled', () => {
  it('shuffles in steps, within limits, and only while the bowler runs in', () => {
    const c = cycle('shuffle');
    let n = 0;
    while (c.shuffle(1)) n += 1;
    expect(c.guard).toBeCloseTo(SHUFFLE_OFF, 5);
    expect(n).toBeGreaterThan(1);
    while (c.shuffle(-1));
    expect(c.guard).toBeCloseTo(-SHUFFLE_LEG, 5);
    c.shuffle(1);
    while (c.phase === 'runUp') c.step(1 / 240);
    const g = c.guard;
    expect(c.shuffle(1)).toBe(false);
    expect(c.guard).toBe(g);
  });

  it('moves the pads and body with him', () => {
    const off = striker.battingHand === 'right' ? 1 : -1;
    const at = batterBoxes(striker.battingHand, null, 0, 70);
    const across = batterBoxes(striker.battingHand, null, 0, 70, undefined, 0.36);
    at.forEach((b, i) => expect(((must(across[i]).minX - b.minX) * off)).toBeCloseTo(0.36, 5));
    const back = batterBoxes(striker.battingHand, attempt('pull', 'back'), 0, 70, undefined, -0.18);
    const backAt = batterBoxes(striker.battingHand, attempt('pull', 'back'), 0, 70);
    expect((must(back[1]).minX - must(backAt[1]).minX) * off).toBeCloseTo(-0.18, 5);
  });

  it('across to the off side, a ball outside off can be worked to leg: better contact on the flick', () => {
    let still = 0;
    let across = 0;
    for (let i = 0; i < 60; i++) {
      for (const g of [0, 0.36]) {
        const c = cycle(`flick-${i}`, 0.35);
        while (c.guard < g - 1e-6) c.shuffle(1);
        let shot = false;
        for (let k = 0; k < 240 * 12 && !c.finished; k++) {
          c.step(1 / 240);
          const eta = c.play ? c.flightTime : 0;
          if (!shot && c.phase === 'inFlight' && eta > 0.32) shot = c.playShot(attempt('flick', 'front'));
        }
        const q = c.play?.contact?.quality ?? 0;
        if (g === 0) still += q;
        else across += q;
      }
    }
    expect(across).toBeGreaterThan(still);
  });
});
