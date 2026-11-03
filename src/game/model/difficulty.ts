/**
 * Difficulty changes how well the computer executes and decides — never the
 * physics, the rules or the result directly.
 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  readonly id: DifficultyId;
  readonly name: string;
  /** Multiplier on the AI's timing error (batting) and release error (bowling). */
  readonly executionError: number;
  /** Multiplier on the AI batter's misjudgement of line, length and pace. */
  readonly perceptionError: number;
  /** How often the AI bowler chooses a tactically sensible plan, 0–1 (the rest are random). */
  readonly tactics: number;
  /** Extra AI reaction delay before reading the ball, seconds. */
  readonly reactionDelay: number;
}

/**
 * Help for a human batter. A press that would bring the bat down a little
 * early or late is met half-way: the swing speeds up or waits (up to these
 * many seconds), as a real batter adjusts the downswing to the ball. The
 * timing window and the reach for the line are wider too, and what is left
 * of a misread off the pitch is smaller.
 */
export interface BattingAssist {
  readonly lateAbsorb: number;
  readonly earlyAbsorb: number;
  /** Multiplier on the timing window. */
  readonly tolerance: number;
  /** Multiplier on how far from the ideal line and height a stroke still finds the middle. */
  readonly reach: number;
  /** Multiplier on the line and height a batter misjudges off the pitch. */
  readonly misread: number;
}

export const BATTING_ASSIST: Readonly<Record<DifficultyId, BattingAssist>> = {
  easy: { lateAbsorb: 0.09, earlyAbsorb: 0.075, tolerance: 1.6, reach: 1.45, misread: 0.45 },
  normal: { lateAbsorb: 0.045, earlyAbsorb: 0.035, tolerance: 1.15, reach: 1.12, misread: 0.85 },
  hard: { lateAbsorb: 0.02, earlyAbsorb: 0.015, tolerance: 1.05, reach: 1.05, misread: 1 },
};

/**
 * Seconds between seeing the ball on screen and the key press reaching the
 * game (the frame being shown, the display, the browser): human presses are
 * dated this much earlier.
 */
export const INPUT_LAG = 0.035;

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = {
  easy: { id: 'easy', name: 'Easy', executionError: 1.6, perceptionError: 1.6, tactics: 0.35, reactionDelay: 0.08 },
  normal: { id: 'normal', name: 'Normal', executionError: 1, perceptionError: 1, tactics: 0.7, reactionDelay: 0.04 },
  hard: { id: 'hard', name: 'Hard', executionError: 0.65, perceptionError: 0.6, tactics: 0.95, reactionDelay: 0 },
};
