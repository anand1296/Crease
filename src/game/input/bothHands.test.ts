import { describe, expect, it } from 'vitest';
import { SAMPLE_TEAMS } from '../data/sampleTeams.ts';
import { findPlayer } from '../data/teams.ts';
import type { DeliveryPlan } from '../bowling/execute.ts';
import { simulateStroke } from '../batting/harness.ts';
import { type BatAction, type ScreenDirection, fieldRegion, shotFromInput } from './battingControls.ts';

const [m, r] = SAMPLE_TEAMS;
if (!m || !r) throw new Error('teams');
const quick = findPlayer(m, (p) => p.name === 'Sam Adeyemi');
const base = findPlayer(r, (p) => p.name === 'Marcus Lyle');

const cases: { keys: string; action: BatAction; dir: ScreenDirection; plan: DeliveryPlan; side: 'off' | 'leg'; behind: boolean; region: RegExp }[] = [
  { keys: 'S ↓→', action: 'front', dir: { x: 1, y: -1 }, plan: { type: 'fast', line: 0.3, length: 3.2 }, side: 'off', behind: false, region: /cover/ },
  { keys: 'W →', action: 'back', dir: { x: 1, y: 0 }, plan: { type: 'fast', line: 0.7, length: 9 }, side: 'off', behind: false, region: /point/ },
  { keys: 'W ↑→', action: 'back', dir: { x: 1, y: 1 }, plan: { type: 'fast', line: 0.7, length: 9 }, side: 'off', behind: true, region: /third man/ },
  { keys: 'W ←', action: 'back', dir: { x: -1, y: 0 }, plan: { type: 'fast', line: -0.05, length: 9.5 }, side: 'leg', behind: false, region: /square leg/ },
  { keys: 'W ↑←', action: 'back', dir: { x: -1, y: 1 }, plan: { type: 'fast', line: -0.05, length: 9.5 }, side: 'leg', behind: true, region: /square leg/ },
  { keys: 'S ←', action: 'front', dir: { x: -1, y: 0 }, plan: { type: 'fast', line: -0.2, length: 4 }, side: 'leg', behind: false, region: /midwicket/ },
];

describe("the arrows follow the batter's own right and left, so a left-hander's keys mirror a right-hander's", () => {
  for (const hand of ['right', 'left'] as const) {
    for (const c of cases) {
      it(`${hand}-hander, ${c.keys}: ${c.side} side${c.behind ? ', behind square' : ''}`, () => {
        const batter = { ...base, battingHand: hand };
        // The cases are written for a right-hander; a left-hander presses the mirror image.
        const dir: ScreenDirection = hand === 'right' ? c.dir : { x: (-c.dir.x) as -1 | 0 | 1, y: c.dir.y };
        const a = shotFromInput(c.action, dir, false, hand);
        expect(fieldRegion(a)).toMatch(c.region);
        const off = hand === 'right' ? 1 : -1;
        let agree = 0;
        let hits = 0;
        for (let i = 0; i < 12; i++) {
          const s = simulateStroke({ bowler: quick, batter, plan: c.plan, attempt: a, timingMs: 0, seed: `${hand}${c.keys}${i}`, deliverySeed: `${hand}${c.keys}${i}` });
          if (s.kind !== 'middled' && s.kind !== 'mistimed') continue;
          hits += 1;
          // Batter-relative direction, and where it went in the world.
          const sideOk = c.side === 'off' ? s.directionDeg > 0 && s.endX * off > 0 : s.directionDeg < 0 && s.endX * off < 0;
          const behindOk = c.behind ? Math.abs(s.directionDeg) > 100 : Math.abs(s.directionDeg) < 110;
          if (sideOk && behindOk) agree += 1;
        }
        expect(hits).toBeGreaterThan(5);
        expect(agree / hits).toBeGreaterThan(0.8);
      });
    }
  }
});
