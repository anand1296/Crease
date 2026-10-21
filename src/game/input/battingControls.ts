import { type ShotAttempt, attempt, push } from '../batting/shots.ts';
import type { Hand } from '../model/player.ts';

/**
 * Maps batting input to a stroke.
 *
 * Directions are screen-relative from the default camera behind the bowler:
 * up = straight back past the bowler, left/right = the sides of the screen,
 * down = behind the batter. Which side is "off" depends on the batter's
 * hand, so the same arrow always sends the ball the same way on screen.
 *
 * Actions: ground stroke, lofted stroke, defend, sweep, leave; holding the
 * back-foot modifier switches strokes that have a back-foot version.
 */
export type BatAction = 'ground' | 'loft' | 'defend' | 'sweep' | 'leave';

export interface ScreenDirection {
  /** −1 left, 0 none, +1 right. */
  readonly x: -1 | 0 | 1;
  /** +1 up (towards the bowler), 0 none, −1 down (behind). */
  readonly y: -1 | 0 | 1;
}

type Side = 'off' | 'leg' | 'none';

/** Screen-left is world +x, which is the off side of a right-hander. */
export function sideOf(dirX: -1 | 0 | 1, hand: Hand): Side {
  if (dirX === 0) return 'none';
  const left = dirX === -1;
  return left === (hand === 'right') ? 'off' : 'leg';
}

export function shotFromInput(action: BatAction, dir: ScreenDirection, backFoot: boolean, hand: Hand): ShotAttempt {
  const side = sideOf(dir.x, hand);
  const fw = backFoot ? 'back' : 'front';
  switch (action) {
    case 'leave':
      return attempt('leave', fw);
    case 'defend': {
      // No direction: a dead bat. With a direction: a push into that area for a single.
      if (side === 'none' && dir.y !== -1) return dir.y === 1 ? push(0, fw) : attempt('block', fw);
      const sign = side === 'off' ? 1 : side === 'leg' ? -1 : 0;
      const angle = dir.y === 1 ? 30 : dir.y === 0 ? 70 : 125;
      return side === 'none' ? push(-150, fw) : push(sign * angle, fw);
    }
    case 'sweep':
      return side === 'off' ? attempt('reverseSweep') : attempt('sweep');
    case 'loft': {
      if (side === 'none') return dir.y === -1 ? attempt('hook') : attempt('loftedDrive');
      if (side === 'leg' && (backFoot || dir.y === -1)) return attempt('hook');
      // Lofted shot aimed into the direction pressed.
      const sign = side === 'off' ? 1 : -1;
      const angle = dir.y === 1 ? 32 : dir.y === 0 ? 65 : 115;
      return attempt('loftedAttack', fw, sign * angle);
    }
    case 'ground': {
      if (side === 'none') return dir.y === -1 ? attempt('legGlance', fw) : attempt('straightDrive', fw);
      if (side === 'off') {
        if (dir.y === 1) return attempt('offDrive', fw);
        if (dir.y === -1) return attempt('lateCut');
        return backFoot ? attempt('squareCut') : attempt('coverDrive');
      }
      if (dir.y === 1) return attempt('onDrive', fw);
      if (dir.y === -1) return attempt('legGlance', fw);
      return backFoot ? attempt('pull') : attempt('flick', fw);
    }
  }
}
