/**
 * Fixed-timestep accumulator. Rendering runs at whatever rate the browser
 * provides; the simulation always advances in identical `stepSeconds` slices,
 * so physics results never depend on frame rate.
 */
export interface FixedStepOptions {
  /** Simulation step length in seconds. */
  readonly stepSeconds: number;
  /**
   * Longest frame delta accepted. Longer gaps (tab hidden, debugger pause)
   * are clamped so the simulation never tries to catch up on seconds of work.
   */
  readonly maxFrameSeconds: number;
}

export const DEFAULT_FIXED_STEP: FixedStepOptions = {
  stepSeconds: 1 / 240,
  maxFrameSeconds: 0.1,
};

export class FixedStepClock {
  private accumulator = 0;
  private readonly options: FixedStepOptions;

  constructor(options: FixedStepOptions = DEFAULT_FIXED_STEP) {
    if (!(options.stepSeconds > 0)) throw new Error('stepSeconds must be positive');
    if (!(options.maxFrameSeconds >= options.stepSeconds)) {
      throw new Error('maxFrameSeconds must be at least one step');
    }
    this.options = options;
  }

  get stepSeconds(): number {
    return this.options.stepSeconds;
  }

  /**
   * Adds a frame delta and returns how many whole simulation steps to run.
   * Non-finite or negative deltas are ignored.
   */
  advance(frameSeconds: number): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;
    this.accumulator += Math.min(frameSeconds, this.options.maxFrameSeconds);
    const steps = Math.floor(this.accumulator / this.options.stepSeconds);
    this.accumulator -= steps * this.options.stepSeconds;
    return steps;
  }

  /** Fraction of a step left over, for interpolating rendered positions. */
  get alpha(): number {
    return this.accumulator / this.options.stepSeconds;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
