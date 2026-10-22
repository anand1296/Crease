import type { Player } from '../model/player.ts';

/**
 * A batter's form during an innings: confidence and tiredness.
 *
 * Confidence (0–1) widens or narrows the window in which a stroke counts as
 * well timed: a set batter who has been finding the middle has more time;
 * one who keeps playing and missing has less. It starts from where he bats
 * and how good he is — top-order batters walk out with more of it than
 * tailenders — and moves ball by ball.
 *
 * Tiredness (0 fresh – 1 spent) builds with hard running (twos and threes
 * cost far more than singles) and, past the first fifth of the innings, with
 * every ball faced; it slows the running between the wickets and takes a
 * little off timing and power. Boundaries and the break between overs give a
 * moment's rest.
 */

export interface BatterState {
  confidence: number;
  fatigue: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Confidence walking out: higher up the order, and the better the batter, the more. */
export function startingConfidence(player: Player, orderIndex: number): number {
  const skill = (player.batting.technique + player.batting.timing) / 200;
  const order = orderIndex <= 2 ? 0.12 : orderIndex <= 5 ? 0.06 : orderIndex <= 7 ? -0.04 : -0.14;
  return clamp01(0.32 + 0.3 * skill + order);
}

/** Multiplies the stroke's timing tolerance: 0.72× with no confidence to 1.28× at full, less a little when tired. */
export function timingScale(s: Readonly<BatterState>): number {
  return (0.72 + 0.56 * clamp01(s.confidence)) * (1 - 0.12 * clamp01(s.fatigue));
}

/** Multiplies bat speed: a tired batter hits a little less hard. */
export function powerScale(s: Readonly<BatterState>): number {
  return 1 - 0.06 * clamp01(s.fatigue);
}

export interface BallForForm {
  /** Contact on this ball: 'miss', 'edge', a clean hit, or none (left / not offered). */
  readonly contact: 'miss' | 'edge' | 'clean' | 'leave' | undefined;
  /** Normalised timing (|t| < 0.3 is perfect), when he hit it. */
  readonly timing?: number | undefined;
  readonly boundary?: 4 | 6 | undefined;
  /** Runs he ran (not boundaries). */
  readonly ranRuns: number;
}

/** Confidence after a ball he faced. */
export function confidenceAfter(c: number, b: BallForForm): number {
  let d = 0;
  if (b.boundary === 6) d += 0.1;
  else if (b.boundary === 4) d += 0.07;
  if (b.contact === 'clean' && b.timing !== undefined) {
    const t = Math.abs(b.timing);
    if (t < 0.3) d += 0.05;
    else if (t > 1.2) d -= 0.03;
  }
  if (b.contact === 'miss') d -= 0.06;
  if (b.contact === 'edge') d -= 0.04;
  if (b.ranRuns > 0) d += 0.01 * b.ranRuns;
  // A long way from the extremes it moves freely; near them, less.
  const room = d > 0 ? 1 - c : c;
  return clamp01(c + d * (0.4 + 0.6 * room));
}

/** Tiredness after a ball: the runs he ran, and the ball itself once he has been in a while. */
export function fatigueAfter(f: number, runs: number, ballsFaced: number, inningsBalls: number, stamina = 60): number {
  // Each extra run on the same ball is harder: 1 → 0.012, 2 → 0.036, 3 → 0.072.
  let gain = 0;
  for (let i = 0; i < runs; i++) gain += 0.012 * (i + 1);
  // Past a fifth of the innings at the crease, the time out there tells.
  if (ballsFaced > inningsBalls / 5) gain += 0.0035;
  return clamp01(f + gain * (1.25 - 0.5 * (stamina / 100)));
}

/** A breather: a boundary (no running) or the change of ends between overs. */
export function rested(f: number, amount: number): number {
  return clamp01(f - amount);
}
