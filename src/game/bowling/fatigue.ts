import type { DeliveryTypeDef } from './deliveryTypes.ts';

/**
 * Bowler fatigue, 0 (fresh) to 1 (exhausted). Builds with every ball —
 * faster for low-stamina bowlers and high-effort deliveries — and recovers
 * while the bowler rests between overs. Fatigue lowers pace and widens
 * execution error (see executeDelivery).
 */
export function fatigueAfterBall(fatigue: number, stamina: number, type: DeliveryTypeDef, effort = 0.75, spellOvers = 1): number {
  // Running in flat out costs more than a stock ball (0.75 effort ≈ 1×, flat out ≈ 1.2×, rolled out ≈ 0.7×);
  // and a long spell tells: from the third over on, each over in a row adds 12%.
  const push = 0.4 + 0.8 * Math.pow(Math.min(1, Math.max(0, effort)), 1.5);
  const spell = 1 + 0.12 * Math.max(0, spellOvers - 2);
  const gain = (0.004 + 0.012 * (1 - stamina / 100)) * type.effort * push * spell;
  return Math.min(1, fatigue + gain);
}

/** Recovery for each over the bowler does not bowl. */
export function fatigueAfterRest(fatigue: number, oversRested = 1): number {
  return Math.max(0, fatigue - 0.09 * oversRested);
}
