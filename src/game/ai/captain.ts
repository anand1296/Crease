import type { FieldPosition } from '../data/fieldPositions.ts';

/**
 * The AI captain: sets the field for each ball.
 *
 * Inputs are what a real captain watches: the bowler's type, the phase of
 * the innings (powerplay, middle, death), and where *this* batter has been
 * scoring (a wagon wheel of their scoring shots, batter-relative, so it is
 * the same for left- and right-handers). Every candidate position has a
 * base value for the bowler type and phase; each scoring shot adds value to
 * the positions near its direction (boundaries to the deep positions,
 * singles and twos to the ring). The captain then takes the best deep
 * positions the fielding restrictions allow and fills the ring, keeping the
 * fielders spread out.
 *
 * Fielding restrictions (as in limited-overs cricket): at most two fielders
 * outside the 30-yard circle in the powerplay, then four, and five at the death.
 */
export interface WagonShot {
  /** Batter-relative direction, degrees: 0 straight back past the bowler, + off side. */
  readonly directionDeg: number;
  readonly runs: number;
}

export interface FieldContext {
  readonly overs: number;
  /** Legal balls bowled so far in the innings. */
  readonly ballsBowled: number;
  readonly spinner: boolean;
  /** This batter's scoring shots in the match. */
  readonly wagon: readonly WagonShot[];
}

export interface FieldDecision {
  /** The nine positions for everyone but the keeper and bowler, close catchers first. */
  readonly positions: readonly FieldPosition[];
  readonly deep: number;
  readonly phase: 'powerplay' | 'middle' | 'death';
  /** The sector the captain is protecting most, if the batter's scoring has moved the field. */
  readonly protecting?: string;
}

interface Candidate extends FieldPosition {
  readonly deep: boolean;
  readonly close?: boolean;
  /** Base value: [pace, spin] × phase. */
  readonly base: { readonly pace: [number, number, number]; readonly spin: [number, number, number] };
}

const RING = 26;
const DEEP = 61;

// Base values per phase: [powerplay, middle, death].
const CANDIDATES: readonly Candidate[] = [
  { id: 'slip1', name: 'First slip', angleDeg: 160, distance: 4.2, deep: false, close: true, base: { pace: [3.2, 0.8, 0.2], spin: [0.9, 0.5, 0.1] } },
  { id: 'gully', name: 'Gully', angleDeg: 125, distance: 12, deep: false, close: true, base: { pace: [1.6, 0.4, 0.1], spin: [0.3, 0.2, 0.1] } },
  { id: 'point', name: 'Point', angleDeg: 100, distance: 24, deep: false, base: { pace: [2.2, 2, 1.8], spin: [2, 2, 1.8] } },
  { id: 'cover', name: 'Cover', angleDeg: 68, distance: RING, deep: false, base: { pace: [2.6, 2.5, 2.3], spin: [2.6, 2.6, 2.3] } },
  { id: 'extracover', name: 'Extra cover', angleDeg: 45, distance: RING, deep: false, base: { pace: [1.2, 1.4, 1.4], spin: [1.4, 1.6, 1.4] } },
  { id: 'midoff', name: 'Mid-off', angleDeg: 22, distance: RING, deep: false, base: { pace: [2.6, 2.4, 2.2], spin: [2.4, 2.4, 2.2] } },
  { id: 'midon', name: 'Mid-on', angleDeg: -22, distance: RING, deep: false, base: { pace: [2.6, 2.4, 2.2], spin: [2.4, 2.4, 2.2] } },
  { id: 'midwicket', name: 'Midwicket', angleDeg: -62, distance: RING, deep: false, base: { pace: [2.2, 2.3, 2.1], spin: [2.4, 2.5, 2.2] } },
  { id: 'squareleg', name: 'Square leg', angleDeg: -100, distance: 24, deep: false, base: { pace: [1.9, 2, 1.9], spin: [2, 2.1, 1.9] } },
  { id: 'shortfine', name: 'Short fine leg', angleDeg: -150, distance: 20, deep: false, base: { pace: [1.1, 1, 0.8], spin: [1.4, 1.2, 1] } },
  { id: 'thirdman', name: 'Third man', angleDeg: 140, distance: DEEP - 3, deep: true, base: { pace: [3, 2.6, 2.8], spin: [0.6, 0.8, 1] } },
  { id: 'deeppoint', name: 'Deep point', angleDeg: 100, distance: DEEP, deep: true, base: { pace: [1.2, 1.8, 2.4], spin: [1.2, 1.6, 2] } },
  { id: 'deepcover', name: 'Deep cover', angleDeg: 62, distance: DEEP, deep: true, base: { pace: [1, 1.8, 2.6], spin: [1.4, 2.2, 2.6] } },
  { id: 'longoff', name: 'Long-off', angleDeg: 16, distance: DEEP + 2, deep: true, base: { pace: [0.8, 1.8, 2.8], spin: [1.6, 2.6, 2.8] } },
  { id: 'longon', name: 'Long-on', angleDeg: -16, distance: DEEP + 2, deep: true, base: { pace: [1, 2, 2.9], spin: [2, 2.8, 3] } },
  { id: 'deepmid', name: 'Deep midwicket', angleDeg: -58, distance: DEEP, deep: true, base: { pace: [1.4, 2.4, 3], spin: [2, 2.8, 3] } },
  { id: 'deepsquare', name: 'Deep square leg', angleDeg: -100, distance: DEEP, deep: true, base: { pace: [1.6, 2.2, 2.6], spin: [1.6, 2.2, 2.4] } },
  { id: 'fineleg', name: 'Fine leg', angleDeg: -158, distance: DEEP - 6, deep: true, base: { pace: [3, 2.4, 2.6], spin: [1.2, 1.2, 1.6] } },
];

const SECTORS: readonly [string, number][] = [
  ['third man', 140],
  ['point', 100],
  ['the covers', 60],
  ['straight down the ground', 0],
  ['midwicket', -60],
  ['square leg', -100],
  ['fine leg', -155],
];

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function fieldingPhase(overs: number, ballsBowled: number): FieldDecision['phase'] {
  const powerplayOvers = overs <= 20 ? Math.max(1, Math.round(overs * 0.3)) : Math.max(1, Math.round(overs * 0.2));
  const deathOvers = overs <= 20 ? Math.max(1, Math.round(overs * 0.2)) : Math.max(1, Math.round(overs * 0.2));
  const over = Math.floor(ballsBowled / 6);
  if (over < powerplayOvers) return 'powerplay';
  if (over >= overs - deathOvers) return 'death';
  return 'middle';
}

/** Fielders allowed outside the 30-yard circle. */
export function maxOutside(phase: FieldDecision['phase']): number {
  return phase === 'powerplay' ? 2 : phase === 'middle' ? 4 : 5;
}

export function setField(ctx: FieldContext): FieldDecision {
  const phase = fieldingPhase(ctx.overs, ctx.ballsBowled);
  const p = phase === 'powerplay' ? 0 : phase === 'middle' ? 1 : 2;
  const value = new Map<string, number>();
  for (const c of CANDIDATES) value.set(c.id, (ctx.spinner ? c.base.spin : c.base.pace)[p]);
  // Where this batter scores: recent shots count most.
  ctx.wagon.forEach((shot, i) => {
    const recency = 0.6 + 0.4 * ((i + 1) / ctx.wagon.length);
    for (const c of CANDIDATES) {
      const near = Math.exp(-((angleDiff(c.angleDeg, shot.directionDeg) / 32) ** 2));
      const weight = c.deep ? (shot.runs >= 4 ? shot.runs * 0.55 : shot.runs * 0.12) : shot.runs >= 4 ? 0.15 : shot.runs * 0.45;
      value.set(c.id, (value.get(c.id) ?? 0) + near * weight * recency);
    }
  });
  const pick = (pool: readonly Candidate[], n: number, separation: number, taken: readonly Candidate[]) => {
    const chosen: Candidate[] = [];
    const sorted = pool.slice().sort((a, b) => (value.get(b.id) ?? 0) - (value.get(a.id) ?? 0) || a.id.localeCompare(b.id));
    for (const c of sorted) {
      if (chosen.length >= n) break;
      if ([...chosen, ...taken].some((o) => o.deep === c.deep && angleDiff(o.angleDeg, c.angleDeg) < separation)) continue;
      chosen.push(c);
    }
    return chosen;
  };
  const deepCount = maxOutside(phase);
  const deep = pick(
    CANDIDATES.filter((c) => c.deep),
    deepCount,
    30,
    [],
  );
  const ring = pick(
    CANDIDATES.filter((c) => !c.deep),
    9 - deep.length,
    20,
    [],
  );
  // Close catchers first (they get the best hands), then the ring, then the deep.
  const positions = [...ring.filter((c) => c.close), ...ring.filter((c) => !c.close), ...deep].map(({ id, name, angleDeg, distance }) => ({ id, name, angleDeg, distance }));

  // Which way has this batter been scoring?
  let protecting: string | undefined;
  const scored = ctx.wagon.reduce((s, w) => s + w.runs, 0);
  if (scored >= 12) {
    let best = 0;
    for (const [name, angle] of SECTORS) {
      const runs = ctx.wagon.filter((w) => angleDiff(w.directionDeg, angle) < 25).reduce((s, w) => s + w.runs, 0);
      if (runs > best && runs >= scored * 0.35) {
        best = runs;
        protecting = name;
      }
    }
  }
  return { positions, deep: deep.length, phase, ...(protecting ? { protecting } : {}) };
}
