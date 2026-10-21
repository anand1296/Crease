/**
 * Seeded, serialisable pseudo-random number generator (sfc32).
 *
 * Every source of randomness in the simulation must come from an `Rng`
 * instance so that a match can be replayed exactly from its seed.
 * `Math.random` is never used by gameplay code.
 */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

/** Hashes an arbitrary string or number into a 32-bit seed (FNV-1a). */
export function hashSeed(input: string | number): number {
  const text = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number) {
    const s = hashSeed(seed);
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = s;
    // Warm up so that similar seeds diverge quickly.
    for (let i = 0; i < 15; i++) this.nextUint32();
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.a = state.a;
    rng.b = state.b;
    rng.c = state.c;
    rng.d = state.d;
    return rng;
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  nextUint32(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Standard normal sample (Box–Muller). */
  normal(mean = 0, stdDev = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Normal sample clamped to ±`limit` standard deviations. Gameplay error
   * terms use this so a single unlucky draw can never produce an absurd value.
   */
  boundedNormal(stdDev: number, limit = 2.5): number {
    const z = Math.max(-limit, Math.min(limit, this.normal()));
    return z * stdDev;
  }

  /** Derives an independent child stream, e.g. one per delivery. */
  fork(label: string | number): Rng {
    return new Rng(`${this.nextUint32()}:${label}`);
  }
}
