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

export const DIFFICULTIES: Readonly<Record<DifficultyId, Difficulty>> = {
  easy: { id: 'easy', name: 'Easy', executionError: 1.6, perceptionError: 1.6, tactics: 0.35, reactionDelay: 0.08 },
  normal: { id: 'normal', name: 'Normal', executionError: 1, perceptionError: 1, tactics: 0.7, reactionDelay: 0.04 },
  hard: { id: 'hard', name: 'Hard', executionError: 0.65, perceptionError: 0.6, tactics: 0.95, reactionDelay: 0 },
};
