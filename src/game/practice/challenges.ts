import { STRIKER_STUMPS_Z } from '../data/field.ts';
import type { BallOutcome } from '../session/deliveryCycle.ts';

/**
 * Practice challenges: one over in the middle, against the computer, with
 * something to achieve. Each challenge reads the over's ball-by-ball record
 * and says how it is going: still on, done, or failed.
 */
export type ChallengeId =
  | 'survive'
  | 'fifteen'
  | 'boundaries'
  | 'six'
  | 'middle'
  | 'wicket'
  | 'tight'
  | 'yorkers'
  | 'bouncers'
  | 'slower'
  | 'targets';

export interface ChallengeStatus {
  readonly state: 'on' | 'won' | 'lost';
  /** One line for the HUD: "Runs 7 of 15 · 3 balls left". */
  readonly progress: string;
}

export interface Challenge {
  readonly id: ChallengeId;
  readonly role: 'bat' | 'bowl';
  readonly name: string;
  readonly goal: string;
  /** Pitching targets (bowling at markers): x across (+ off side of the batter), metres from the striker's stumps. */
  readonly targets?: readonly { readonly x: number; readonly fromStumps: number }[];
  check(balls: readonly BallOutcome[], over: boolean, off: 1 | -1): ChallengeStatus;
}

const legal = (b: BallOutcome) => !b.wide && !b.noBall;
const left = (balls: readonly BallOutcome[]) => Math.max(0, 6 - balls.filter(legal).length);
const ballsLeft = (balls: readonly BallOutcome[]) => `${left(balls)} ball${left(balls) === 1 ? '' : 's'} left`;
const runsOf = (balls: readonly BallOutcome[]) => balls.reduce((a, b) => a + b.runs + b.extras, 0);
const fromStumps = (b: BallOutcome) => (b.delivery.length === undefined ? undefined : STRIKER_STUMPS_Z - b.delivery.length);

/** Needs `n` of something in the over: won as soon as it is reached, lost when there are not enough balls left. */
function count(n: number, label: string, got: (b: BallOutcome) => boolean) {
  return (balls: readonly BallOutcome[], over: boolean): ChallengeStatus => {
    const k = balls.filter(got).length;
    const progress = `${label} ${Math.min(k, n)} of ${n} · ${ballsLeft(balls)}`;
    if (k >= n) return { state: 'won', progress };
    if (over || k + left(balls) < n) return { state: 'lost', progress };
    return { state: 'on', progress };
  };
}

/** Where the marker challenge wants each ball to pitch (cycles if there are extras). */
export const MARKER_TARGETS = [
  { x: 0.15, fromStumps: 6.5 },
  { x: 0.05, fromStumps: 1.2 },
  { x: 0.3, fromStumps: 4.5 },
  { x: -0.05, fromStumps: 8.5 },
  { x: 0.2, fromStumps: 3 },
  { x: 0.1, fromStumps: 5.5 },
] as const;
/** How close to a marker counts as hitting it, metres. */
export const MARKER_RADIUS = 0.45;

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'survive',
    role: 'bat',
    name: 'Survive the over',
    goal: 'Face a full over from a fast bowler without getting out.',
    check: (balls, over) => {
      const out = balls.some((b) => b.wicket);
      const progress = out ? 'Out!' : `Still there · ${ballsLeft(balls)}`;
      return { state: out ? 'lost' : over || left(balls) === 0 ? 'won' : 'on', progress };
    },
  },
  {
    id: 'fifteen',
    role: 'bat',
    name: 'Fifteen off the over',
    goal: 'Score 15 or more from the over.',
    check: (balls, over) => {
      const r = runsOf(balls);
      const progress = `Runs ${r} of 15 · ${ballsLeft(balls)}`;
      if (r >= 15) return { state: 'won', progress };
      if (over || r + left(balls) * 6 < 15) return { state: 'lost', progress };
      return { state: 'on', progress };
    },
  },
  { id: 'boundaries', role: 'bat', name: 'Two boundaries', goal: 'Hit two fours or sixes in the over.', check: count(2, 'Boundaries', (b) => b.boundary !== undefined) },
  { id: 'six', role: 'bat', name: 'Clear the rope', goal: 'Hit a six.', check: count(1, 'Sixes', (b) => b.boundary === 6) },
  {
    id: 'middle',
    role: 'bat',
    name: 'Out of the middle',
    goal: 'Middle four balls of the over — timing over power.',
    check: count(4, 'Middled', (b) => b.contact?.kind === 'middled'),
  },
  { id: 'wicket', role: 'bowl', name: 'Take a wicket', goal: 'Take a wicket in the over.', check: count(1, 'Wickets', (b) => b.wicket !== undefined) },
  {
    id: 'tight',
    role: 'bowl',
    name: 'A tight over',
    goal: 'Concede five runs or fewer in the over (wides and no-balls count).',
    check: (balls, over) => {
      const r = runsOf(balls);
      const progress = `Conceded ${r} of 5 · ${ballsLeft(balls)}`;
      if (r > 5) return { state: 'lost', progress };
      return { state: over || left(balls) === 0 ? 'won' : 'on', progress };
    },
  },
  {
    id: 'yorkers',
    role: 'bowl',
    name: 'Two yorkers',
    goal: 'Land two yorkers — pitched within a metre and a half of the batter’s stumps.',
    check: count(2, 'Yorkers', (b) => {
      const d = fromStumps(b);
      return d !== undefined && d > 0 && d <= 1.6;
    }),
  },
  {
    id: 'bouncers',
    role: 'bowl',
    name: 'Two bouncers',
    goal: 'Bowl two bouncers that get up past shoulder height (one per over is legal in T20; a second is a no-ball — but it still counts here).',
    check: count(2, 'Bouncers', (b) => {
      const d = fromStumps(b);
      return d !== undefined && d >= 8.5 && (b.delivery.height ?? 0) > 1.3;
    }),
  },
  { id: 'slower', role: 'bowl', name: 'Change of pace', goal: 'Bowl two slower balls on a good length (4–8 m from the stumps).', check: count(2, 'Slower balls', (b) => b.delivery.type === 'slower' && (fromStumps(b) ?? 0) >= 4 && (fromStumps(b) ?? 0) <= 8) },
  {
    id: 'targets',
    role: 'bowl',
    name: 'Hit the markers',
    goal: 'A marker on the pitch for every ball: land three of the six on it.',
    targets: MARKER_TARGETS,
    check: (balls, over, off) => count(3, 'Markers hit', (b) => markerHit(b, balls.indexOf(b), off))(balls, over),
  },
];

export function challenge(id: ChallengeId): Challenge {
  const c = CHALLENGES.find((x) => x.id === id);
  if (!c) throw new Error(`No challenge ${id}`);
  return c;
}

/** The marker for ball `i` of the over, in world coordinates. */
export function markerFor(i: number, off: 1 | -1): { x: number; z: number } {
  const t = MARKER_TARGETS[i % MARKER_TARGETS.length] ?? MARKER_TARGETS[0];
  return { x: t.x * off, z: STRIKER_STUMPS_Z - t.fromStumps };
}

/** Did ball `i` pitch on its marker? */
export function markerHit(b: BallOutcome, i: number, off: 1 | -1): boolean {
  if (b.delivery.length === undefined || b.delivery.pitchX === undefined) return false;
  const m = markerFor(i, off);
  return Math.hypot(b.delivery.pitchX - m.x, b.delivery.length - m.z) <= MARKER_RADIUS;
}

// --- Best results, kept in the browser ---------------------------------------------------

const KEY = 'crease.challenges';

export function completedChallenges(): Set<ChallengeId> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as ChallengeId[]) : []);
  } catch {
    return new Set();
  }
}

export function markCompleted(id: ChallengeId): void {
  try {
    const done = completedChallenges();
    done.add(id);
    localStorage.setItem(KEY, JSON.stringify([...done]));
  } catch {
    // Not kept.
  }
}
