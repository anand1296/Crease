import { Rng } from '../core/rng.ts';
import type { PitchId } from '../data/pitches.ts';

/**
 * The toss. The opposing captain spins the coin and the player calls it;
 * the winner chooses to bat or bowl. Everything is decided by the match
 * seed, so a toss can be replayed exactly; the 3D scene only shows it.
 */
export type CoinFace = 'heads' | 'tails';
export type TossChoice = 'bat' | 'bowl';

/** Which way the coin comes down for this seed. */
export function coinFor(seed: string): CoinFace {
  return new Rng(`${seed}:coin`).chance(0.5) ? 'heads' : 'tails';
}

/**
 * What a computer captain does on winning the toss: bat on a flat deck,
 * bowl on a green one; otherwise a slight preference for batting.
 */
export function computerChoice(pitch: PitchId, seed: string): TossChoice {
  if (pitch === 'green') return 'bowl';
  if (pitch === 'flat') return 'bat';
  return new Rng(`${seed}:choice`).chance(0.55) ? 'bat' : 'bowl';
}

export function tossLine(winner: string, choice: TossChoice): string {
  return `${winner} won the toss and chose to ${choice}.`;
}

// --- The coin in the air ------------------------------------------------------------------

const G = 9.81;
/** Upward speed of the flick, m/s: about a metre above the hand, as a captain tosses. */
export const FLICK_SPEED = 4.3;
/** Turns the coin makes on the way up and down. */
const TURNS = 7;
/** A real coin is ~2.5 cm across; drawn a little larger so it reads on screen. */
export const COIN_RADIUS = 0.024;
export const COIN_THICKNESS = 0.0035;

/** Seconds from the flick until the coin lands, from a hand at `height`. */
export function flightTime(height: number): number {
  return (FLICK_SPEED + Math.sqrt(FLICK_SPEED * FLICK_SPEED + 2 * G * (height - COIN_THICKNESS / 2))) / G;
}

/** Seconds after the flick when the coin is still on the pitch and the result can be shown. */
export const COIN_SETTLED = 0.45;

export interface CoinState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation about the coin's diameter (radians); 0 = heads up, π = tails up. */
  readonly flip: number;
  readonly landed: boolean;
}

/**
 * Where the coin is `t` seconds after the flick from `from`, drifting
 * `drift` metres sideways (x, z) by the time it lands. It turns end over
 * end and comes to rest flat with `face` up after a small bounce.
 */
export function coinAt(t: number, from: { x: number; y: number; z: number }, drift: { x: number; z: number }, face: CoinFace): CoinState {
  const T = flightTime(from.y);
  const rest = face === 'heads' ? TURNS * 2 * Math.PI : TURNS * 2 * Math.PI + Math.PI;
  if (t <= 0) return { ...from, flip: 0, landed: false };
  if (t < T) {
    const u = t / T;
    const y = from.y + FLICK_SPEED * t - 0.5 * G * t * t;
    // Spins fast off the thumb and a little slower as it falls; ends flat on the face that is up.
    const flip = rest * u * (1.25 - 0.25 * u);
    return { x: from.x + drift.x * u, y: Math.max(COIN_THICKNESS / 2, y), z: from.z + drift.z * u, flip, landed: false };
  }
  // On the pitch: a small hop and a rattle, settling flat.
  const s = t - T;
  const hop = Math.max(0, 0.035 * Math.sin(Math.min(1, s / 0.16) * Math.PI)) * Math.exp(-s * 3);
  const wobble = 0.35 * Math.exp(-s * 9) * Math.sin(s * 40);
  return { x: from.x + drift.x * (1 + Math.min(s, 0.2) * 0.3), y: COIN_THICKNESS / 2 + hop, z: from.z + drift.z * (1 + Math.min(s, 0.2) * 0.3), flip: rest + wobble, landed: true };
}

/** Which face is up for a flip angle. */
export function faceUp(flip: number): CoinFace {
  return Math.cos(flip) >= 0 ? 'heads' : 'tails';
}
