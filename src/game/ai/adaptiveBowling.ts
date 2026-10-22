import type { Rng } from '../core/rng.ts';
import { type DeliveryTypeId, deliveriesFor } from '../bowling/deliveryTypes.ts';
import type { Difficulty } from '../model/difficulty.ts';
import { type Player, isSpinner } from '../model/player.ts';
import type { BowlingDecision } from './bowlingAi.ts';

/**
 * A bowling attack that learns the batter in front of it.
 *
 * The bowler chooses among a handful of *plans* — a delivery type aimed at a
 * line and length ("yorker at the stumps", "wide yorker", "bouncer",
 * "slower ball, full", "off-break outside off" …). Choosing a plan is a
 * multi-armed bandit, solved with Thompson sampling:
 *
 *  - each ball's reward is what it did for the fielding side: minus the runs
 *    conceded, plus a little for a dot ball or beating the bat, plus a lot
 *    for a wicket;
 *  - every plan has a Gaussian belief about its mean reward against this
 *    batter, starting from a prior that already knows cricket (yorkers and
 *    slower balls are better at the death, swing and slips in the
 *    powerplay, bouncers are a surprise weapon, not a stock ball);
 *  - beliefs are pooled across batters (the whole batting line-up is the
 *    same human), with each batter's own record weighted more;
 *  - each ball, a reward is sampled from every plan's belief and the best
 *    sample wins. Plans that have worked get bowled more; plans that have
 *    been hit get dropped — while every plan keeps some chance of being tried.
 *
 * Difficulty sets how much the attack relies on what it has learned: Easy
 * bowlers mostly follow their usual mix, Hard ones exploit weaknesses quickly.
 * Deterministic for a given RNG.
 */
export interface BowlingPlan {
  readonly id: string;
  readonly label: string;
  readonly type: DeliveryTypeId;
  readonly line: number;
  readonly length: number;
  /** Prior mean reward by phase [powerplay, middle, death]. */
  readonly prior: readonly [number, number, number];
}

const PACE_PLANS: readonly BowlingPlan[] = [
  { id: 'stumps-good', label: 'good length at the stumps', type: 'fast', line: 0.02, length: 5.6, prior: [-1.0, -1.0, -1.6] },
  { id: 'corridor', label: 'the corridor outside off', type: 'fast', line: 0.2, length: 5.4, prior: [-0.9, -1.0, -1.5] },
  { id: 'outswing', label: 'full outswingers', type: 'outswinger', line: 0.14, length: 4.4, prior: [-0.9, -1.2, -1.8] },
  { id: 'inswing', label: 'inswingers at the pads', type: 'inswinger', line: 0.02, length: 4.6, prior: [-1.0, -1.2, -1.8] },
  { id: 'hard-length', label: 'back of a length', type: 'fast', line: 0.1, length: 8.2, prior: [-1.3, -1.1, -1.4] },
  { id: 'bouncer', label: 'the bouncer', type: 'bouncer', line: 0.12, length: 11, prior: [-1.5, -1.4, -1.5] },
  { id: 'yorker', label: 'yorkers at the stumps', type: 'yorker', line: 0.0, length: 0.9, prior: [-1.6, -1.4, -0.9] },
  { id: 'wide-yorker', label: 'wide yorkers', type: 'yorker', line: 0.58, length: 0.9, prior: [-1.8, -1.5, -1.0] },
  { id: 'slower-full', label: 'slower balls, full', type: 'slower', line: 0.12, length: 3.6, prior: [-1.5, -1.3, -1.1] },
  { id: 'slower-short', label: 'slower bouncers', type: 'slower', line: 0.2, length: 8.8, prior: [-1.6, -1.3, -1.2] },
];

const SPIN_PLANS: readonly BowlingPlan[] = [
  { id: 'stock-stumps', label: 'stock balls at the stumps', type: 'offBreak', line: 0.0, length: 4.3, prior: [-1.0, -0.9, -1.4] },
  { id: 'stock-off', label: 'turning away outside off', type: 'offBreak', line: 0.3, length: 4.5, prior: [-1.1, -1.0, -1.4] },
  { id: 'flighted', label: 'flight, full', type: 'offBreak', line: 0.1, length: 3.0, prior: [-1.4, -1.2, -1.8] },
  { id: 'flat-quick', label: 'flatter and quicker', type: 'topSpinner', line: 0.05, length: 5.4, prior: [-1.1, -1.1, -1.2] },
  { id: 'variation', label: 'the one that turns the other way', type: 'doosra', line: 0.1, length: 4.4, prior: [-1.2, -1.0, -1.3] },
];

/** Reward for the fielding side from one ball. */
export function ballReward(o: { runs: number; extras: number; wicket: boolean; beaten: boolean }): number {
  const r = -(o.runs + o.extras) + (o.runs + o.extras === 0 ? 0.6 : 0) + (o.beaten ? 0.5 : 0) + (o.wicket ? 18 : 0);
  return Math.max(-7, Math.min(18, r));
}

interface Stat {
  n: number;
  sum: number;
}

/** Per-ball reward noise (runs from one ball vary a lot). */
const SIGMA = 3.2;
/** Pseudo-observations behind the prior. */
const PRIOR_N = 4;
/** How much the team-wide record counts towards a batter's own. */
const POOL = 0.5;

export interface AdaptiveDecision extends BowlingDecision {
  readonly planId: string;
  /** Set when the choice exploits something learned: why this plan. */
  readonly insight?: string;
}

export class AdaptiveBowling {
  private readonly perBatter = new Map<string, Map<string, Stat>>();
  private readonly team = new Map<string, Stat>();

  plansFor(bowler: Player): BowlingPlan[] {
    const available = new Set(deliveriesFor(bowler.bowlingStyle).map((d) => d.id));
    if (!isSpinner(bowler.bowlingStyle)) return PACE_PLANS.filter((p) => available.has(p.type));
    // Spinners: map the stock and variation balls to this bowler's own.
    const stock: DeliveryTypeId = bowler.bowlingStyle === 'offSpin' ? 'offBreak' : 'legBreak';
    const variation: DeliveryTypeId = bowler.bowlingStyle === 'offSpin' ? 'doosra' : 'googly';
    return SPIN_PLANS.map((p) => ({ ...p, type: p.type === 'offBreak' ? stock : p.type === 'doosra' ? variation : p.type })).filter((p) => available.has(p.type));
  }

  /** Mean belief and its uncertainty for a plan against a batter. */
  belief(batterId: string, plan: BowlingPlan, phase: 0 | 1 | 2): { mean: number; sd: number; n: number } {
    const own = this.perBatter.get(batterId)?.get(plan.id) ?? { n: 0, sum: 0 };
    const team = this.team.get(plan.id) ?? { n: 0, sum: 0 };
    const teamOther = { n: (team.n - own.n) * POOL, sum: (team.sum - own.sum) * POOL };
    const n = PRIOR_N + teamOther.n + own.n;
    const mean = (PRIOR_N * plan.prior[phase] + teamOther.sum + own.sum) / n;
    return { mean, sd: SIGMA / Math.sqrt(n), n: own.n };
  }

  choose(bowler: Player, batter: Player, phase: 0 | 1 | 2, difficulty: Difficulty, rng: Rng): AdaptiveDecision {
    const plans = this.plansFor(bowler);
    // Easy attacks explore more (wider samples); hard ones exploit what they know.
    const explore = 1.6 - 0.9 * difficulty.tactics;
    let best: { plan: BowlingPlan; sample: number } | undefined;
    for (const plan of plans) {
      const b = this.belief(batter.id, plan, phase);
      const sample = b.mean + b.sd * explore * rng.normal();
      if (!best || sample > best.sample) best = { plan, sample };
    }
    const plan = best?.plan ?? plans[0];
    if (!plan) throw new Error('no plans');
    // Execute the plan with the bowler's usual imprecision of intent.
    const disciplined = rng.chance(difficulty.tactics);
    const line = plan.line + rng.boundedNormal(disciplined ? 0.06 : 0.14);
    const length = Math.max(0.3, plan.length + rng.boundedNormal(plan.length < 1.5 ? 0.15 : disciplined ? 0.5 : 1.1));
    const acc = bowler.bowling.accuracy / 100;
    const releaseQuality = Math.max(0, Math.min(1, 1 - Math.abs(rng.boundedNormal((0.08 + 0.2 * (1 - acc)) * difficulty.executionError))));
    return { plan: { type: plan.type, line, length }, releaseQuality, planId: plan.id, ...this.explain(batter, plan, plans, phase) };
  }

  learn(batterId: string, planId: string, reward: number): void {
    let own = this.perBatter.get(batterId);
    if (!own) {
      own = new Map();
      this.perBatter.set(batterId, own);
    }
    for (const m of [own, this.team]) {
      const s = m.get(planId) ?? { n: 0, sum: 0 };
      m.set(planId, { n: s.n + 1, sum: s.sum + reward });
    }
  }

  /** What the attack has learned about a batter: plans tried, best and worst. */
  report(batter: Player, bowler: Player, phase: 0 | 1 | 2): { plan: BowlingPlan; mean: number; n: number }[] {
    return this.plansFor(bowler)
      .map((plan) => ({ plan, ...this.belief(batter.id, plan, phase) }))
      .sort((a, b) => b.mean - a.mean);
  }

  private explain(batter: Player, plan: BowlingPlan, plans: readonly BowlingPlan[], phase: 0 | 1 | 2): { insight?: string } {
    const own = this.perBatter.get(batter.id)?.get(plan.id);
    if (!own || own.n < 3) return {};
    const mine = this.belief(batter.id, plan, phase).mean;
    const average = plans.reduce((s, p) => s + this.belief(batter.id, p, phase).mean, 0) / plans.length;
    if (mine < average + 0.4) return {};
    return { insight: `${plan.label} — ${batter.name.split(' ').slice(-1)[0] ?? batter.name} has struggled against those` };
  }
}
