import { describe, expect, it } from 'vitest';
import { findPlayer } from '../data/teams.ts';
import { SAMPLE_TEAMS as TEAMS } from '../data/sampleTeams.ts';
import type { Player } from '../model/player.ts';
import type { DeliveryPlan } from '../bowling/execute.ts';
import { type StrokeScenario, mean, rate, sd, simulateMany, simulateStroke } from './harness.ts';
import { MAX_BALL_SPEED } from '../physics/ball.ts';
import { attempt } from './shots.ts';

/**
 * Batting acceptance tests (GAME_DESIGN.md §Batting). Each one checks a
 * specific, measurable behaviour; passing them does not by itself make the
 * model realistic.
 */
const [mariners, rangers] = TEAMS;
if (!mariners || !rangers) throw new Error('sample teams missing');
const quick = findPlayer(mariners, (p) => p.name === 'Sam Adeyemi');
const offie = findPlayer(mariners, (p) => p.name === 'Imran Qadir');
const batter = findPlayer(rangers, (p) => p.name === 'Marcus Lyle');

const withBatting = (p: Player, v: number): Player => ({
  ...p,
  batting: { technique: v, timing: v, power: p.batting.power, footwork: v, defence: v },
});
const elite = withBatting(batter, 95);
const tailender = withBatting(batter, 25);

const full: DeliveryPlan = { type: 'fast', line: 0.25, length: 3.5 };
const goodStraight: DeliveryPlan = { type: 'fast', line: 0.05, length: 5 };
const shortWide: DeliveryPlan = { type: 'fast', line: 0.6, length: 8 };
const bouncer: DeliveryPlan = { type: 'bouncer', line: 0, length: 10.5 };

const base = (over: Partial<StrokeScenario>): Omit<StrokeScenario, 'seed'> => ({
  bowler: quick,
  batter,
  plan: full,
  attempt: attempt('coverDrive'),
  timingMs: 0,
  ...over,
});

describe('1. different shot intentions produce different outcomes', () => {
  it('drive, cut, pull, glance and block go to different places at different speeds', () => {
    const cover = simulateMany(base({ plan: full, attempt: attempt('coverDrive') }), 20);
    const cut = simulateMany(base({ plan: shortWide, attempt: attempt('squareCut') }), 20);
    const pull = simulateMany(base({ plan: bouncer, attempt: attempt('pull') }), 20);
    const glance = simulateMany(base({ plan: { type: 'fast', line: -0.2, length: 6 }, attempt: attempt('legGlance', 'back') }), 20);
    const block = simulateMany(base({ plan: goodStraight, attempt: attempt('block') }), 20);
    const dir = (xs: typeof cover) => mean(xs.filter((s) => s.kind === 'middled' || s.kind === 'mistimed').map((s) => s.directionDeg));
    expect(dir(cover)).toBeGreaterThan(40);
    expect(dir(cover)).toBeLessThan(70);
    expect(dir(cut)).toBeGreaterThan(75);
    expect(dir(pull)).toBeLessThan(-55);
    expect(dir(glance)).toBeLessThan(-125);
    expect(mean(block.map((s) => s.exitSpeed))).toBeLessThan(10);
    expect(mean(cover.map((s) => s.exitSpeed))).toBeGreaterThan(25);
  });

  it('the same keys against the same ball can be sent anywhere from straight to square by the stroke chosen', () => {
    // Compare cleanly struck balls: a stroke that does not suit the line may edge, which is tested elsewhere.
    const angles = (['straightDrive', 'offDrive', 'coverDrive'] as const).map((shot) =>
      mean(
        simulateMany(base({ plan: { type: 'fast', line: 0.22, length: 3.5 }, attempt: attempt(shot) }), 15)
          .filter((s) => s.kind === 'middled')
          .map((s) => s.directionDeg),
      ),
    );
    expect(angles[1] ?? 0).toBeGreaterThan((angles[0] ?? 0) + 12);
    expect(angles[2] ?? 0).toBeGreaterThan((angles[1] ?? 0) + 15);
  });
});

describe('2. line and length change the result of the same input', () => {
  it('a cover drive goes squarer and finer off a wider ball, and climbs off a shorter one', () => {
    const shot = attempt('coverDrive');
    const onOff = simulateMany(base({ plan: { type: 'fast', line: 0.25, length: 3.5 }, attempt: shot }), 25);
    const wide = simulateMany(base({ plan: { type: 'fast', line: 1.0, length: 3.5 }, attempt: shot }), 25);
    const short = simulateMany(base({ plan: { type: 'fast', line: 0.25, length: 8.5 }, attempt: shot }), 25);
    // A wide ball is reached for: more edges and poorer contact.
    expect(rate(wide, (s) => s.kind === 'edge' || s.kind === 'miss')).toBeGreaterThan(rate(onOff, (s) => s.kind === 'edge' || s.kind === 'miss') + 0.15);
    // A short ball is above the shot's ideal height: it goes up.
    expect(mean(short.filter((s) => s.kind !== 'miss').map((s) => s.elevationDeg))).toBeGreaterThan(
      mean(onOff.filter((s) => s.kind !== 'miss').map((s) => s.elevationDeg)) + 5,
    );
  });

  it('identical inputs against different deliveries never give identical trajectories', () => {
    const plans: DeliveryPlan[] = [
      { type: 'fast', line: 0.2, length: 3 },
      { type: 'fast', line: 0.3, length: 4.5 },
      { type: 'outswinger', line: 0.2, length: 3.5 },
      { type: 'slower', line: 0.25, length: 3.5 },
    ];
    const results = plans.map((plan) => simulateStroke({ ...base({ plan }), seed: 'same' }));
    const keys = new Set(results.map((r) => `${r.directionDeg.toFixed(1)}/${r.exitSpeed.toFixed(1)}/${r.elevationDeg.toFixed(1)}`));
    expect(keys.size).toBe(plans.length);
  });
});

describe('3. timing matters, continuously', () => {
  it('early and late rotate the ball opposite ways, and further off-time is worse', () => {
    const at = (ms: number) => simulateMany(base({ attempt: attempt('straightDrive'), plan: { type: 'fast', line: 0.05, length: 3.5 }, timingMs: ms, deliverySeed: 'd' }), 25);
    const ontime = at(0);
    const early = at(-20);
    const late = at(20);
    const veryLate = at(45);
    const dir = (xs: typeof ontime) => mean(xs.filter((s) => s.kind !== 'miss').map((s) => s.directionDeg));
    const q = (xs: typeof ontime) => mean(xs.map((s) => s.quality));
    // Straight-bat shot: late opens the face towards the off side, early closes it.
    expect(dir(late)).toBeGreaterThan(dir(ontime) + 4);
    expect(dir(early)).toBeLessThan(dir(ontime) - 4);
    expect(q(ontime)).toBeGreaterThan(q(late));
    expect(q(late)).toBeGreaterThan(q(veryLate));
    expect(mean(veryLate.map((s) => s.exitSpeed))).toBeLessThan(mean(ontime.map((s) => s.exitSpeed)));
  });

  it('the timing window is tighter against pace than against spin', () => {
    const lateBy = 25;
    const vsPace = simulateMany(base({ plan: { type: 'fast', line: 0.05, length: 3.5 }, attempt: attempt('straightDrive'), timingMs: lateBy }), 25);
    // The off-break turns in, so it is aimed a little wider to finish in the straight drive's zone.
    const vsSpin = simulateMany(base({ bowler: offie, plan: { type: 'offBreak', line: 0.18, length: 3.5 }, attempt: attempt('straightDrive'), timingMs: lateBy }), 25);
    expect(mean(vsSpin.map((s) => s.quality))).toBeGreaterThan(mean(vsPace.map((s) => s.quality)) + 0.1);
  });

  it('a late cut is less forgiving of timing than a defensive block', () => {
    const ms = 30;
    const cut = simulateMany(base({ plan: shortWide, attempt: attempt('lateCut'), timingMs: ms }), 25);
    const block = simulateMany(base({ plan: goodStraight, attempt: attempt('block'), timingMs: ms }), 25);
    expect(mean(block.map((s) => s.quality))).toBeGreaterThan(mean(cut.map((s) => s.quality)) + 0.2);
  });
});

describe('4. skill controls consistency', () => {
  it('an elite batter places the same shot more consistently than a tailender', () => {
    const run = (b: Player) => simulateMany(base({ batter: b, timingMs: 12, deliverySeed: 'fixed' }), 40);
    const pro = run(elite);
    const tail = run(tailender);
    const ok = (xs: typeof pro) => xs.filter((s) => s.kind === 'middled' || s.kind === 'mistimed');
    expect(sd(ok(pro).map((s) => s.directionDeg))).toBeLessThan(sd(ok(tail).map((s) => s.directionDeg)));
    expect(rate(tail, (s) => s.kind === 'edge' || s.kind === 'miss')).toBeGreaterThan(rate(pro, (s) => s.kind === 'edge' || s.kind === 'miss'));
  });
});

describe('5. poor contact produces edges, mistimes and misses', () => {
  it('error rates rise as timing gets worse', () => {
    const bad = (ms: number) => rate(simulateMany(base({ timingMs: ms }), 40), (s) => s.kind !== 'middled');
    expect(bad(0)).toBeLessThan(0.25);
    expect(bad(35)).toBeGreaterThan(bad(0) + 0.3);
    expect(bad(90)).toBeGreaterThan(0.9);
  });

  it('outside edges go behind on the off side; very late strokes on straight balls lose the stumps or pads', () => {
    const outsideEdges = simulateMany(base({ plan: { type: 'fast', line: 0.65, length: 4 }, timingMs: 25 }), 60).filter((s) => s.edge === 'outside');
    expect(outsideEdges.length).toBeGreaterThan(3);
    expect(mean(outsideEdges.map((s) => s.directionDeg))).toBeGreaterThan(95);
    const tooLate = simulateMany(base({ plan: { type: 'fast', line: 0, length: 4 }, attempt: attempt('straightDrive'), timingMs: 150 }), 20);
    expect(rate(tooLate, (s) => s.end === 'bowled' || s.end === 'pad')).toBeGreaterThan(0.8);
  });
});

describe('6–7. determinism and bounded variation', () => {
  it('identical inputs and seeds give identical results', () => {
    const s: StrokeScenario = { ...base({ timingMs: 7 }), seed: 'repeat' };
    expect(simulateStroke(s)).toEqual(simulateStroke(s));
  });

  it('different seeds vary the result without breaking the link between input and outcome', () => {
    const xs = simulateMany(base({ attempt: attempt('coverDrive'), deliverySeed: 'one-ball' }), 40).filter((s) => s.kind === 'middled');
    expect(xs.length).toBeGreaterThan(30);
    const dirs = xs.map((s) => s.directionDeg);
    expect(sd(dirs)).toBeGreaterThan(0.3);
    expect(sd(dirs)).toBeLessThan(8);
    expect(Math.abs(mean(dirs) - 55)).toBeLessThan(10);
  });
});

describe('8. lofted shots: higher, riskier', () => {
  it('lofted drives launch higher, carry further and are in the air where fielders are', () => {
    const plan: DeliveryPlan = { type: 'fast', line: 0.05, length: 3.5 };
    const ground = simulateMany(base({ plan, attempt: attempt('straightDrive') }), 30);
    const lofted = simulateMany(base({ plan, attempt: attempt('loftedDrive') }), 30);
    expect(mean(lofted.map((s) => s.elevationDeg))).toBeGreaterThan(mean(ground.map((s) => s.elevationDeg)) + 20);
    expect(mean(lofted.map((s) => s.apex))).toBeGreaterThan(5);
    expect(rate(lofted, (s) => s.airborneChance)).toBeGreaterThan(0.7);
    expect(rate(ground, (s) => s.airborneChance)).toBeLessThan(0.15);
  });

  it('mistimed lofted shots fall short', () => {
    const lofted = (ms: number) => simulateMany(base({ plan: { type: 'fast', line: 0.05, length: 3.5 }, attempt: attempt('loftedDrive'), timingMs: ms }), 30);
    expect(mean(lofted(30).map((s) => s.carry))).toBeLessThan(mean(lofted(0).map((s) => s.carry)) - 10);
  });
});

describe('9. defence prioritises control', () => {
  it('the block is slower, lower and edges less than an attacking stroke to the same balls', () => {
    const plan: DeliveryPlan = { type: 'outswinger', line: 0.2, length: 5 };
    const attack = simulateMany(base({ plan, attempt: attempt('coverDrive'), timingMs: 15 }), 50);
    const block = simulateMany(base({ plan, attempt: attempt('block'), timingMs: 15 }), 50);
    expect(mean(block.map((s) => s.exitSpeed))).toBeLessThan(mean(attack.map((s) => s.exitSpeed)) * 0.4);
    expect(rate(block, (s) => s.kind === 'edge' || s.kind === 'miss')).toBeLessThan(rate(attack, (s) => s.kind === 'edge' || s.kind === 'miss'));
    // A forward block can still edge to the slips, but rarely.
    expect(rate(block, (s) => s.airborneChance)).toBeLessThan(0.1);
  });
});

describe('10. numerical stability', () => {
  it('every stroke in a broad sweep stays finite and physically bounded', () => {
    const shots = ['straightDrive', 'coverDrive', 'squareCut', 'pull', 'hook', 'sweep', 'reverseSweep', 'loftedAttack', 'legGlance', 'lateCut'] as const;
    const plans: DeliveryPlan[] = [full, goodStraight, shortWide, bouncer, { type: 'yorker', line: 0, length: 1 }, { type: 'fullToss', line: 0, length: 0 }];
    for (const shot of shots) {
      for (const plan of plans) {
        for (const ms of [-60, 0, 40]) {
          const s = simulateStroke({ ...base({ plan, attempt: attempt(shot), timingMs: ms }), seed: `${shot}${ms}` });
          for (const v of [s.exitSpeed, s.directionDeg, s.elevationDeg, s.carry, s.apex, s.distance]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          expect(s.exitSpeed).toBeLessThanOrEqual(MAX_BALL_SPEED);
          expect(s.apex).toBeLessThan(60);
        }
      }
    }
  });
});
