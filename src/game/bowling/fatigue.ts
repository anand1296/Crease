import type { DeliveryTypeDef } from './deliveryTypes.ts';

/**
 * Bowler fatigue, 0 (fresh) to 1 (exhausted). Builds with every ball —
 * faster for low-stamina bowlers and high-effort deliveries — and recovers
 * while the bowler rests between overs. Fatigue lowers pace and widens
 * execution error (see executeDelivery).
 */
export function fatigueAfterBall(fatigue: number, stamina: number, type: DeliveryTypeDef): number {
  const gain = (0.004 + 0.012 * (1 - stamina / 100)) * type.effort;
  return Math.min(1, fatigue + gain);
}

/** Recovery for each over the bowler does not bowl. */
export function fatigueAfterRest(fatigue: number, oversRested = 1): number {
  return Math.max(0, fatigue - 0.09 * oversRested);
}
