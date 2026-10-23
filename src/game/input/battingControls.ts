import { type Footwork, SHOTS, type ShotAttempt, type ShotId, attempt } from '../batting/shots.ts';
import type { Hand } from '../model/player.ts';

/**
 * Batting controls, after EA Sports Cricket 07's keyboard scheme:
 *
 *   S  front-foot shot     (S alone: forward defence)
 *   W  back-foot shot      (W alone: back-foot defence)
 *   D  use your feet: step out and play (D alone: smother it)
 *   A  leave
 *   Shift (hold)  lofted version of the shot
 *   Arrows        direction. ↓ straight back past the bowler, ↑ behind
 *                 the batter (fine), and sideways by the batter's sides:
 *                 → is always the off side and ← the leg side, for right-
 *                 and left-handers alike ("batter" arrows, the default).
 *                 So ↑→ on the back foot is the late cut to third man, ↑←
 *                 the pull (the hook, lofted) round to fine leg, and ↑← on
 *                 the front foot the slog sweep.
 *
 *                 "Screen" arrows instead follow the picture from behind the
 *                 bowler: ← is screen-left (a right-hander's off side, a
 *                 left-hander's leg side).
 */
export type ArrowScheme = 'batter' | 'screen';

const ARROWS_KEY = 'crease.arrows';

export function readArrowScheme(): ArrowScheme {
  try {
    return localStorage.getItem(ARROWS_KEY) === 'screen' ? 'screen' : 'batter';
  } catch {
    return 'batter';
  }
}

export function saveArrowScheme(s: ArrowScheme): void {
  try {
    localStorage.setItem(ARROWS_KEY, s);
  } catch {
    // Not persisted.
  }
}

export type BatAction = 'front' | 'back' | 'feet' | 'leave';

export interface ScreenDirection {
  /** −1 left, 0 none, +1 right. */
  readonly x: -1 | 0 | 1;
  /** +1 up the screen (behind the batter), 0 none, −1 down the screen (straight, towards the bowler). */
  readonly y: -1 | 0 | 1;
}

type Side = 'off' | 'leg' | 'none';

/**
 * Batter arrows: right is the off side. Screen arrows: screen-left is world
 * +x, which is the off side of a right-hander.
 */
export function sideOf(dirX: -1 | 0 | 1, hand: Hand, scheme: ArrowScheme = 'batter'): Side {
  if (dirX === 0) return 'none';
  if (scheme === 'batter') return dirX === 1 ? 'off' : 'leg';
  const left = dirX === -1;
  return left === (hand === 'right') ? 'off' : 'leg';
}

/**
 * Batter-relative direction (degrees from straight, + off side) for an arrow
 * combination, or undefined for no arrow.
 */
export function directionOf(dir: ScreenDirection, hand: Hand, scheme: ArrowScheme = 'batter'): number | undefined {
  const side = sideOf(dir.x, hand, scheme);
  if (side === 'none') return dir.y === -1 ? 0 : dir.y === 1 ? 180 : undefined;
  const s = side === 'off' ? 1 : -1;
  return s * (dir.y === -1 ? 45 : dir.y === 0 ? 90 : 135);
}

const at = (shot: ShotId, fw: Footwork, aim?: number): ShotAttempt => attempt(shot, fw, aim);

function groundShot(fw: Footwork, d: number): ShotAttempt {
  if (fw === 'back') {
    switch (d) {
      // Back foot: the punch past mid-off, the cut, and working it square and behind on the leg side.
      case 0: return at('straightDrive', 'back');
      case 45: return at('offDrive', 'back');
      case 90: return at('squareCut', 'back');
      case 135: return at('lateCut', 'back');
      case 180: return at('legGlance', 'back');
      case -135: return at('pull', 'back', -118);
      case -90: return at('pull', 'back');
      default: return at('flick', 'back', -45);
    }
  }
  if (fw === 'out') {
    switch (d) {
      case 0: return at('straightDrive', 'out');
      case 45: return at('coverDrive', 'out', 45);
      case 90: return at('coverDrive', 'out', 82);
      case 135: return at('coverDrive', 'out', 100);
      case 180: return at('flick', 'out', -150);
      case -135: return at('flick', 'out', -125);
      case -90: return at('flick', 'out', -88);
      default: return at('onDrive', 'out');
    }
  }
  switch (d) {
    case 0: return at('straightDrive', 'front');
    case 45: return at('coverDrive', 'front');
    case 90: return at('coverDrive', 'front', 80);
    case 135: return at('lateCut', 'front');
    // Fine leg along the ground: the sweep (the glance is on the back foot).
    case 180: return at('sweep', 'front', -150);
    // Behind square on the leg side off the front foot: the slog sweep.
    case -135: return at('slogSweep', 'front');
    case -90: return at('flick', 'front');
    default: return at('onDrive', 'front');
  }
}

function loftedShot(fw: Footwork, d: number | undefined): ShotAttempt {
  if (d === undefined || d === 0) return fw === 'back' ? at('loftedAttack', 'back', 0) : at('loftedDrive', fw);
  // Down the pitch and over the top: long-off and long-on.
  if (fw === 'out' && (d === 45 || d === -45)) return at('loftedAttack', 'out', d > 0 ? 25 : -25);
  if (fw === 'front') {
    if (d === 135) return at('reverseSweep', 'front');
    if (d === -135) return at('slogSweep', 'front');
    if (d === 180) return at('loftedAttack', 'front', -165);
  }
  if (fw === 'back') {
    if (d === -135 || d === 180) return at('hook', 'back');
    if (d === -90) return at('loftedAttack', 'back', -85);
  }
  return at('loftedAttack', fw, d === 180 ? -160 : d);
}

export function shotFromInput(action: BatAction, dir: ScreenDirection, lofted: boolean, hand: Hand, scheme: ArrowScheme = 'batter'): ShotAttempt {
  if (action === 'leave') return at('leave', 'front');
  const fw: Footwork = action === 'back' ? 'back' : action === 'feet' ? 'out' : 'front';
  const d = directionOf(dir, hand, scheme);
  if (lofted) return loftedShot(fw, d);
  if (d === undefined) return at('block', fw);
  return groundShot(fw, d);
}

/** The direction a stroke is aimed, degrees from straight (+ off side). */
export function shotAngle(a: ShotAttempt): number {
  return a.aimDeg ?? SHOTS[a.shot].direction;
}

/**
 * Where on the field a stroke is aimed, by the fielding position there
 * (the deep position for a lofted shot).
 */
export function fieldRegion(a: ShotAttempt): string {
  const def = SHOTS[a.shot];
  if (def.kind === 'leave') return 'left alone';
  if (def.kind === 'defence' && !a.push) return 'dead bat';
  const deg = shotAngle(a);
  const deep = def.kind === 'loft' || a.shot === 'slogSweep';
  const off = deg >= 0;
  const x = Math.abs(deg);
  if (x < 12) return deep ? 'straight, over the bowler' : 'straight';
  if (off) {
    if (x < 35) return deep ? 'long-off' : 'mid-off';
    if (x < 66) return deep ? 'deep cover' : 'cover';
    if (x < 104) return deep ? 'deep point' : 'point';
    if (x < 128) return deep ? 'third man' : 'backward point';
    return 'third man';
  }
  if (x < 35) return deep ? 'long-on' : 'mid-on';
  if (x < 70) return deep ? 'deep midwicket' : 'midwicket';
  if (x < 104) return deep ? 'deep square leg' : 'square leg';
  if (x < 135) return deep ? 'deep backward square' : 'backward square leg';
  return 'fine leg';
}
