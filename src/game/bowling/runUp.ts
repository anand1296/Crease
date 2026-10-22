import type { BowlingStyle } from '../model/player.ts';

/**
 * Run-ups. A fast bowler's is long and accelerating (≈18 m, the last strides
 * at 6–7 m/s); a spinner walks in off a few paces (≈5 m). The simulation's
 * release time and the renderer's run-up both come from here, so the bowler
 * is always at the crease when the ball leaves the hand.
 */
export interface RunUp {
  /** Metres from the mark to the delivery stride. */
  readonly distance: number;
  /** Seconds from leaving the mark to release. */
  readonly duration: number;
  /** Length of the delivery stride (bound, back foot, front foot, release), seconds before release. */
  readonly stride: number;
}

export function runUpFor(style: BowlingStyle): RunUp {
  switch (style) {
    case 'fast':
      return { distance: 18, duration: 2.35, stride: 0.55 };
    case 'fastMedium':
      return { distance: 15, duration: 2.15, stride: 0.52 };
    case 'medium':
      return { distance: 11, duration: 1.85, stride: 0.5 };
    case 'offSpin':
    case 'legSpin':
      return { distance: 5, duration: 1.45, stride: 0.48 };
    case 'none':
      return { distance: 8, duration: 1.6, stride: 0.48 };
  }
}

/** Which side of the stumps the bowler delivers from. */
export type BowlingSide = 'over' | 'around';
