/**
 * The adaptive-quality decision, kept free of React and three.js so it can
 * be tested: feed it frame times, it says when to go a level lighter or try
 * a level richer.
 *
 * Every `window` frames it takes the median frame time. Slower than ≈45 fps
 * → one level lighter. After a step down it waits for a run of smooth
 * windows and tries one level back up; if that proves too slow again it
 * stays put for good. The median ignores occasional hitches (garbage
 * collection, a tab switch), so one bad frame never costs resolution.
 */
export interface FrameBudgetOptions {
  readonly window: number;
  /** Median frame time (s) above which to go lighter. */
  readonly slow: number;
  /** Median frame time (s) below which a window counts as smooth (a 60 Hz display caps at 1/60). */
  readonly smooth: number;
  /** Smooth windows in a row before trying a richer level. */
  readonly upgradeAfter: number;
  readonly maxLevel: number;
  /** Frames ignored after a change, while things settle. */
  readonly settle: number;
}

export const DEFAULT_FRAME_BUDGET: FrameBudgetOptions = {
  window: 90,
  slow: 1 / 45,
  smooth: 1 / 55,
  upgradeAfter: 6,
  maxLevel: 3,
  settle: 45,
};

export class FrameBudgetController {
  private samples: number[] = [];
  private smoothWindows = 0;
  private upgradeFailed = false;
  private lastWasUpgrade = false;
  private skip: number;

  constructor(private readonly o: FrameBudgetOptions = DEFAULT_FRAME_BUDGET) {
    this.skip = o.settle;
  }

  /** Ignore the next frames (after a pause, a loading screen, a resize). */
  settle(frames = this.o.settle): void {
    this.skip = Math.max(this.skip, frames);
    this.samples = [];
  }

  /** Adds one frame's duration; returns the new level when it should change. */
  push(delta: number, level: number): number | undefined {
    if (this.skip > 0) {
      this.skip--;
      return undefined;
    }
    // A gap of seconds is a background tab or a debugger, not the frame rate.
    if (!(delta > 0) || delta > 3) return undefined;
    this.samples.push(delta);
    if (this.samples.length < this.o.window) return undefined;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.samples = [];

    if (median > this.o.slow && level < this.o.maxLevel) {
      if (this.lastWasUpgrade) this.upgradeFailed = true;
      this.lastWasUpgrade = false;
      this.smoothWindows = 0;
      this.skip = this.o.settle;
      return level + 1;
    }
    if (median < this.o.smooth && level > 0 && !this.upgradeFailed) {
      this.smoothWindows++;
      if (this.smoothWindows >= this.o.upgradeAfter) {
        this.smoothWindows = 0;
        this.lastWasUpgrade = true;
        this.skip = this.o.settle;
        return level - 1;
      }
      return undefined;
    }
    this.smoothWindows = 0;
    // A level that has held up through a full window is no longer on trial.
    if (median <= this.o.slow) this.lastWasUpgrade = false;
    return undefined;
  }
}
