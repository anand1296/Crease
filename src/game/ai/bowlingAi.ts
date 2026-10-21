import type { Rng } from '../core/rng.ts';
import { type DeliveryTypeId, deliveriesFor } from '../bowling/deliveryTypes.ts';
import type { DeliveryPlan } from '../bowling/execute.ts';
import type { Difficulty } from '../model/difficulty.ts';
import type { Player } from '../model/player.ts';

/**
 * Computer bowler (P1 version). Chooses a delivery type and target from the
 * bowler's repertoire: mostly stock balls in the off-stump corridor, mixed
 * with variations; on higher difficulty, more disciplined lines and lengths
 * and variations aimed where they work (yorkers full, bouncers short).
 * Match-situation tactics (required rate, batter weaknesses, field) build on
 * this in P3.
 */
export interface BowlingDecision {
  readonly plan: DeliveryPlan;
  /** 0–1, fed to executeDelivery as the release quality. */
  readonly releaseQuality: number;
}

const PACE_WEIGHTS: Partial<Record<DeliveryTypeId, number>> = {
  fast: 34, outswinger: 18, inswinger: 14, yorker: 9, bouncer: 11, slower: 12, fullToss: 0,
};
const SPIN_WEIGHTS: Partial<Record<DeliveryTypeId, number>> = {
  offBreak: 62, legBreak: 62, topSpinner: 16, doosra: 12, googly: 12, fullToss: 0,
};

/** Typical target length for each delivery, metres in front of the stumps. */
const TARGET_LENGTH: Partial<Record<DeliveryTypeId, [mean: number, spread: number]>> = {
  fast: [5.6, 1.2], outswinger: [4.6, 1], inswinger: [4.8, 1], yorker: [0.9, 0.2], bouncer: [10.5, 0.8],
  slower: [5, 1.2], offBreak: [4.3, 0.9], legBreak: [4.6, 1], topSpinner: [4.6, 0.8], doosra: [4.4, 0.8], googly: [4.6, 0.8],
  fullToss: [0, 0],
};

export function chooseDelivery(bowler: Player, difficulty: Difficulty, rng: Rng): BowlingDecision {
  const options = deliveriesFor(bowler.bowlingStyle);
  const weights = bowler.bowlingStyle === 'offSpin' || bowler.bowlingStyle === 'legSpin' ? SPIN_WEIGHTS : PACE_WEIGHTS;
  const total = options.reduce((sum, d) => sum + (weights[d.id] ?? 0), 0);
  let pick = rng.range(0, total);
  let type: DeliveryTypeId = options[0]?.id ?? 'fast';
  for (const d of options) {
    pick -= weights[d.id] ?? 0;
    if (pick <= 0) {
      type = d.id;
      break;
    }
  }
  const disciplined = rng.chance(difficulty.tactics);
  const [lengthMean, lengthSpread] = TARGET_LENGTH[type] ?? [5, 1];
  const length = Math.max(0.3, lengthMean + rng.boundedNormal(disciplined ? lengthSpread * 0.6 : lengthSpread * 1.6));
  // The corridor of uncertainty: just outside off stump.
  const line = disciplined ? 0.15 + rng.boundedNormal(0.1) : rng.boundedNormal(0.35);
  const acc = bowler.bowling.accuracy / 100;
  const releaseQuality = Math.max(0, Math.min(1, 1 - Math.abs(rng.boundedNormal((0.08 + 0.2 * (1 - acc)) * difficulty.executionError))));
  return { plan: { type, line, length }, releaseQuality };
}
