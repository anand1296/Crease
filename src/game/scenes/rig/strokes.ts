import { Vector3 } from 'three';
import { SHOTS, type ShotAttempt, type ShotId } from '../../batting/shots.ts';

/**
 * Batting strokes as motion: where the batter's hands and bat are at every
 * moment of a stroke, and where his body has to be for the bat's sweet spot
 * to meet the ball.
 *
 * Every stroke belongs to a family with its own shape — the drive (bat comes
 * down straight, finishes high over the front shoulder), the cut (bat
 * horizontal to the off side, finishes across the body), the pull and hook
 * (horizontal across the line, wraps round the shoulder), the flick and
 * glance (straight bat, wrists turn it to leg), the sweep (down on one knee,
 * bat sweeps low), the block (dead bat, no follow-through) and the leave
 * (hands high, bat out of the way). Each has a backlift, a posture at
 * contact and a follow-through; the swing between them is an accelerating
 * arc.
 *
 * Coordinates are world space; a batter frame gives the directions that
 * matter: F towards the bowler (−z), S towards the batter's off side
 * (±x), U up.
 */
export type StrokeFamily = 'drive' | 'cut' | 'pull' | 'flick' | 'sweep' | 'reverse' | 'block' | 'leave';

const FAMILY: Readonly<Record<ShotId, StrokeFamily>> = {
  straightDrive: 'drive',
  coverDrive: 'drive',
  offDrive: 'drive',
  onDrive: 'drive',
  loftedDrive: 'drive',
  loftedAttack: 'drive',
  squareCut: 'cut',
  lateCut: 'cut',
  pull: 'pull',
  hook: 'pull',
  flick: 'flick',
  legGlance: 'flick',
  sweep: 'sweep',
  slogSweep: 'sweep',
  reverseSweep: 'reverse',
  block: 'block',
  leave: 'leave',
};

export const familyOf = (shot: ShotId): StrokeFamily => FAMILY[shot];

/** Hands (top of the handle) to the bat's sweet spot, metres. */
export const SWEET = 0.62;
/** Shoulder height of a standing batter, metres. */
const SHOULDER_Y = 1.42;
/** Comfortable reach of both hands together from the centre of the shoulders. */
export const REACH = 0.62;

interface Shape {
  /** Hands relative to the shoulders at contact (S, F, U). */
  readonly contactHands: readonly [number, number, number];
  /** Bat direction (hands → toe) at contact, in S, F, U before normalising. */
  readonly contactBat: readonly [number, number, number];
  /** Top of the backlift: hands (S, F, U from the shoulders) and bat. */
  readonly topHands: readonly [number, number, number];
  readonly topBat: readonly [number, number, number];
  /** Finish of the follow-through. */
  readonly finishHands: readonly [number, number, number];
  readonly finishBat: readonly [number, number, number];
  /** Crouch at contact, metres, and forward lean of the trunk. */
  readonly drop: number;
  readonly lean: number;
}

const SHAPES: Readonly<Record<StrokeFamily, Shape>> = {
  drive: {
    contactHands: [0.26, 0.24, -0.48],
    contactBat: [0.05, 0.12, -1],
    topHands: [-0.05, -0.22, 0.12],
    topBat: [0.3, -0.55, 0.75],
    finishHands: [0.1, 0.3, 0.3],
    finishBat: [0, -0.45, 0.9],
    drop: 0.14,
    lean: 0.55,
  },
  cut: {
    contactHands: [0.32, 0.08, -0.2],
    contactBat: [0.85, 0.3, -0.42],
    topHands: [-0.02, -0.18, 0.22],
    topBat: [0.25, -0.45, 0.85],
    finishHands: [0.12, 0.25, 0.05],
    finishBat: [-0.55, 0.55, 0.35],
    drop: 0.05,
    lean: 0.25,
  },
  pull: {
    contactHands: [0.18, 0.3, -0.18],
    contactBat: [0.55, 0.65, -0.25],
    topHands: [-0.02, -0.18, 0.25],
    topBat: [0.25, -0.4, 0.88],
    finishHands: [-0.18, 0.12, 0.18],
    finishBat: [-0.45, -0.55, 0.65],
    drop: 0.06,
    lean: 0.15,
  },
  flick: {
    contactHands: [0.16, 0.28, -0.46],
    contactBat: [-0.05, 0.25, -1],
    topHands: [-0.04, -0.18, 0.08],
    topBat: [0.3, -0.5, 0.75],
    finishHands: [0.0, 0.32, -0.12],
    finishBat: [-0.65, 0.4, -0.45],
    drop: 0.12,
    lean: 0.45,
  },
  sweep: {
    contactHands: [0.25, 0.32, -0.32],
    contactBat: [0.25, 0.85, -0.45],
    topHands: [-0.05, -0.15, 0.1],
    topBat: [0.3, -0.5, 0.75],
    finishHands: [-0.12, 0.28, -0.2],
    finishBat: [-0.8, 0.25, -0.2],
    drop: 0.48,
    lean: 0.5,
  },
  reverse: {
    contactHands: [0.12, 0.32, -0.32],
    contactBat: [0.75, 0.6, -0.4],
    topHands: [-0.05, -0.12, 0.1],
    topBat: [-0.4, -0.3, 0.8],
    finishHands: [0.3, 0.25, -0.15],
    finishBat: [0.85, -0.2, -0.1],
    drop: 0.48,
    lean: 0.5,
  },
  block: {
    contactHands: [0.22, 0.3, -0.42],
    contactBat: [0.02, -0.18, -1],
    topHands: [0.0, -0.12, 0.0],
    topBat: [0.25, -0.35, 0.4],
    finishHands: [0.22, 0.3, -0.42],
    finishBat: [0.02, -0.18, -1],
    drop: 0.12,
    lean: 0.5,
  },
  leave: {
    contactHands: [-0.08, -0.1, 0.32],
    contactBat: [0.15, -0.3, 0.95],
    topHands: [-0.08, -0.1, 0.32],
    topBat: [0.15, -0.3, 0.95],
    finishHands: [-0.08, -0.1, 0.32],
    finishBat: [0.15, -0.3, 0.95],
    drop: 0.06,
    lean: 0.3,
  },
};

/** Lofted strokes finish higher; sweeps that are slogged finish over the shoulder. */
function finishFor(shot: ShotId, s: Shape): { hands: readonly [number, number, number]; bat: readonly [number, number, number] } {
  if (shot === 'loftedDrive' || shot === 'loftedAttack') return { hands: [0.05, 0.25, 0.42], bat: [0, -0.35, 0.95] };
  if (shot === 'slogSweep') return { hands: [-0.12, 0.15, 0.2], bat: [-0.4, -0.45, 0.8] };
  if (shot === 'hook') return { hands: [-0.2, 0.05, 0.3], bat: [-0.35, -0.6, 0.7] };
  if (shot === 'lateCut' || shot === 'legGlance') return { hands: s.contactHands, bat: s.contactBat };
  return { hands: s.finishHands, bat: s.finishBat };
}

export interface StrokeInput {
  readonly attempt: ShotAttempt;
  /** Batter's off side: +1 when the off side is world +x (a right-hander). */
  readonly off: 1 | -1;
  /** Where the bat should meet the ball (world). */
  readonly contact: Vector3;
  /** Batter-relative direction the ball is being hit (degrees). */
  readonly aimDeg: number;
  /** 0 → 1 from pressing the key to the bat meeting the ball. */
  readonly k: number;
  /** 0 → 1 through the follow-through. */
  readonly follow: number;
  /** Where the batter stands in his stance (world, feet). */
  readonly stance: Vector3;
}

export interface StrokeFrame {
  /** Where the batter's feet are (world). */
  readonly root: Vector3;
  readonly drop: number;
  readonly lean: number;
  /** Trunk turn towards the shot, radians (+ towards the off side). */
  readonly turn: number;
  /** Top of the handle (world) and the bat's direction, handle to toe. */
  readonly hands: Vector3;
  readonly bat: Vector3;
  /** How far the body has travelled towards its contact position, 0–1. */
  readonly step: number;
}

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};

/** Converts batter-frame (S, F, U) to a world vector. */
function world(v: readonly [number, number, number], off: 1 | -1, out = new Vector3()): Vector3 {
  return out.set(v[0] * off, v[2], -v[1]);
}

/** Rotates a world vector about the vertical by `deg` towards the batter's off side. */
function turnBy(v: Vector3, deg: number, off: 1 | -1): Vector3 {
  const a = ((deg * Math.PI) / 180) * off;
  const x = v.x * Math.cos(a) - v.z * Math.sin(a);
  const z = v.x * Math.sin(a) + v.z * Math.cos(a);
  return v.set(x, v.y, z);
}

const slerp = (a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 => {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const theta = Math.acos(dot);
  if (theta < 1e-4) return out.copy(b);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
};

/**
 * The batter's body and bat at one moment of a stroke. Contact is exact:
 * at k = 1 the sweet spot is on the contact point.
 */
export function strokeFrame(i: StrokeInput): StrokeFrame {
  const shot = i.attempt.shot;
  const fam = familyOf(shot);
  const s = SHAPES[fam];
  const off = i.off;
  // Turn the shapes towards where the ball is being hit (relative to the family's natural direction).
  const natural = fam === 'drive' ? SHOTS[shot].direction : 0;
  const swivel = fam === 'drive' ? (i.aimDeg - natural) * 0.5 + natural * 0.6 : 0;

  const batC = turnBy(world(s.contactBat, off), swivel, off).normalize();
  const handsC = i.contact.clone().addScaledVector(batC, -SWEET);
  const relC = turnBy(world(s.contactHands, off), swivel, off);
  // Shoulders where they must be for the hands to be there, and the feet below them.
  const shouldersC = handsC.clone().sub(relC);
  const drop = Math.min(0.55, Math.max(0, SHOULDER_Y - shouldersC.y));
  const rootC = new Vector3(shouldersC.x, 0, shouldersC.z);
  // The body gets there over the first part of the stroke (stepping out takes the longest).
  const step = smooth(i.k * (i.attempt.footwork === 'out' ? 1.15 : 1.5));
  const root = i.stance.clone().lerp(rootC, fam === 'leave' ? 0.4 * step : step);
  const shoulders = new Vector3(root.x, SHOULDER_Y - drop * step, root.z);

  const top = shoulders.clone().add(world(s.topHands, off));
  const batTop = world(s.topBat, off).normalize();
  const fin = finishFor(shot, s);
  const finishHands = shoulders.clone().add(turnBy(world(fin.hands, off), swivel, off));
  const finishBat = turnBy(world(fin.bat, off), swivel, off).normalize();
  const stanceHands = new Vector3(i.stance.x + 0.27 * off, 0.88, i.stance.z - 0.1);
  const stanceBat = new Vector3(0.15 * off, -1, 0.12).normalize();

  const hands = new Vector3();
  const bat = new Vector3();
  if (fam === 'leave') {
    const u = smooth(i.k * 2);
    hands.lerpVectors(stanceHands, top, u);
    slerp(stanceBat, batTop, u, bat);
  } else if (i.follow > 0) {
    // Follow-through: decelerating.
    const u = 1 - (1 - Math.min(1, i.follow)) ** 2;
    const contactHands = shoulders.clone().add(relC);
    hands.lerpVectors(contactHands, finishHands, u);
    slerp(batC, finishBat, u, bat);
  } else if (i.k < 0.38) {
    // Pick-up into the backlift.
    const u = smooth(i.k / 0.38);
    hands.lerpVectors(stanceHands, top, u);
    slerp(stanceBat, batTop, u, bat);
  } else {
    // The downswing: accelerating, on an arc that brings the hands down close to the body.
    const u = (i.k - 0.38) / 0.62;
    const a = u * u;
    const contactHands = shoulders.clone().add(relC);
    const ctrl = top.clone().lerp(contactHands, 0.5);
    ctrl.y -= 0.12;
    ctrl.addScaledVector(world([0, -1, 0], off), 0.1);
    hands
      .copy(top)
      .multiplyScalar((1 - a) * (1 - a))
      .addScaledVector(ctrl, 2 * a * (1 - a))
      .addScaledVector(contactHands, a * a);
    slerp(batTop, batC, a, bat);
  }
  // At contact the bat is exactly where the ball is.
  if (fam !== 'leave' && i.k >= 1 && i.follow <= 0) hands.copy(handsC);
  // Keep the hands within reach of the shoulders.
  const fromShoulders = hands.clone().sub(shoulders);
  if (fromShoulders.length() > REACH) hands.copy(shoulders).addScaledVector(fromShoulders.normalize(), REACH);

  const aimTurn = fam === 'cut' || fam === 'reverse' ? 0.5 : fam === 'pull' || fam === 'sweep' || fam === 'flick' ? -0.6 : (i.aimDeg / 90) * 0.35;
  const through = Math.min(1, Math.max(0, (i.k - 0.5) * 2) + i.follow);
  return {
    root,
    drop: drop * step,
    lean: 0.3 + (s.lean - 0.3) * step,
    turn: aimTurn * through,
    hands,
    bat,
    step,
  };
}
