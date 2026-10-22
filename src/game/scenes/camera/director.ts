import { BOWLER_STUMPS_Z, FIELD, STRIKER_STUMPS_Z } from '../../data/field.ts';

/**
 * The broadcast director: which camera is "on air" and where it points,
 * as a pure function of the state of the ball. Modelled on television
 * coverage (and Cricket 07):
 *
 *  - between balls, a wide shot from behind the bowler's arm;
 *  - during the run-up, that camera slowly pushes in and the lens tightens,
 *    so by the moment of release the striker fills the frame;
 *  - after the shot, a moment on the stroke, then a cut to a high camera
 *    side-on to the ball's path that follows the ball and the chase;
 *  - when the stumps are hit, a cut to a low camera at the striker's stumps;
 *  - after the ball is dead the coverage holds, then cuts back for the next ball.
 *
 * The rig smooths between successive outputs unless `cut` is true.
 */
export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface Shot {
  readonly name: 'wide' | 'aim' | 'runUp' | 'delivery' | 'stroke' | 'chase' | 'stumps' | 'hold';
  readonly pos: Vec;
  readonly look: Vec;
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Jump straight to this shot rather than easing towards it. */
  readonly cut: boolean;
  /** How quickly the rig eases towards the shot (1/s). */
  readonly ease: number;
}

export interface DirectorInput {
  /** 'tv': long lens from far behind the bowler; 'classic': lower and closer, as in Cricket 07. */
  readonly style?: 'tv' | 'classic';
  /** Cycle phase, or undefined between balls. */
  readonly phase: 'runUp' | 'inFlight' | 'struck' | 'dead' | undefined;
  /** Cycle time (s since the start of the run-up), release time, contact time. */
  readonly time: number;
  readonly releaseTime: number;
  readonly contactTime: number | undefined;
  /** Cycle time the stumps were hit, if they were. */
  readonly stumpsTime: number | undefined;
  readonly ball: Vec | undefined;
  /** Nearest fielder to the ball (or the one carrying it), if any. */
  readonly chaser: Vec | undefined;
  /** Seconds since the director's previous shot started (for holding a cut). */
  readonly previous: Shot['name'] | undefined;
  /**
   * A human is bowling: between balls the camera rises behind the bowler to
   * frame the whole pitch and the landing marker, and the run-up pushes in
   * from there.
   */
  readonly humanBowling?: boolean;
}

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Behind the bowler's arm, wide: the whole pitch and the close field. */
export const WIDE: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: 0, y: 12.5, z: BOWLER_STUMPS_Z - 46 },
  look: { x: 0, y: 0.6, z: 0 },
  fov: 15,
};
/** Same camera, tight on the striker at the moment of release. */
export const TIGHT: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: 0, y: 8.6, z: BOWLER_STUMPS_Z - 36 },
  look: { x: 0, y: 1.05, z: STRIKER_STUMPS_Z - 1.6 },
  fov: 9.5,
};

/** Classic (Cricket 07) framing: lower and closer behind the bowler's arm. */
export const CLASSIC_WIDE: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: -0.9, y: 5.2, z: BOWLER_STUMPS_Z - 27 },
  look: { x: 0, y: 0.8, z: 2 },
  fov: 30,
};
export const CLASSIC_TIGHT: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  // High enough that the line to the striker clears the bowler's-end umpire's hat.
  pos: { x: -0.6, y: 3.9, z: BOWLER_STUMPS_Z - 17 },
  look: { x: 0, y: 1.0, z: STRIKER_STUMPS_Z - 1.2 },
  fov: 19,
};

/** The bowler's view while setting up a ball: high behind the bowler's arm, the whole pitch in frame. */
export const AIM: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: 0, y: 7.8, z: BOWLER_STUMPS_Z - 13 },
  look: { x: 0, y: 0.2, z: STRIKER_STUMPS_Z - 5 },
  fov: 30,
};

/** How long the stroke is shown from the bowler's end before the chase camera takes over. */
export const STROKE_HOLD = 0.45;

export function direct(input: DirectorInput): Shot {
  const { phase, time, releaseTime, ball } = input;
  const classic = input.style === 'classic';
  const WIDE_ = input.humanBowling ? AIM : classic ? CLASSIC_WIDE : WIDE;
  const TIGHT_ = classic ? CLASSIC_TIGHT : TIGHT;

  if (phase === undefined) {
    const name = input.humanBowling ? 'aim' : 'wide';
    return {
      name,
      pos: { ...WIDE_.pos },
      look: { ...WIDE_.look },
      fov: WIDE_.fov,
      cut: input.previous !== name && input.previous !== 'runUp' && input.previous !== undefined && input.previous !== 'wide' && input.previous !== 'aim',
      ease: 1.5,
    };
  }

  if (phase === 'runUp' || (phase === 'inFlight' && input.contactTime === undefined && input.stumpsTime === undefined)) {
    // Push in through the run-up; arrive on the tight frame a beat before release.
    const u = smooth(time / Math.max(0.1, releaseTime - 0.15));
    return {
      name: phase === 'runUp' ? 'runUp' : 'delivery',
      pos: { x: lerp(WIDE_.pos.x, TIGHT_.pos.x, u), y: lerp(WIDE_.pos.y, TIGHT_.pos.y, u), z: lerp(WIDE_.pos.z, TIGHT_.pos.z, u) },
      look: { x: lerp(WIDE_.look.x, TIGHT_.look.x, u), y: lerp(WIDE_.look.y, TIGHT_.look.y, u), z: lerp(WIDE_.look.z, TIGHT_.look.z, u) },
      fov: lerp(WIDE_.fov, TIGHT_.fov, u),
      cut: false,
      // Follow the dolly closely: it is already smooth.
      ease: 12,
    };
  }

  // Bowled, or run out at the striker's end: a low shot of the broken wicket.
  if (input.stumpsTime !== undefined && time - input.stumpsTime > 0.35) {
    return {
      name: 'stumps',
      pos: { x: 1.6, y: 0.55, z: STRIKER_STUMPS_Z + 3.2 },
      look: { x: 0, y: 0.45, z: STRIKER_STUMPS_Z },
      fov: 32,
      cut: input.previous !== 'stumps',
      ease: 3,
    };
  }

  if (input.contactTime === undefined || !ball) {
    // Beaten, padded or left: stay tight on the batter and the keeper.
    return { name: 'delivery', pos: { ...TIGHT_.pos }, look: { ...TIGHT_.look }, fov: TIGHT_.fov, cut: false, ease: 3 };
  }

  const since = time - input.contactTime;
  const fromBat = Math.hypot(ball.x, ball.z - STRIKER_STUMPS_Z);
  if (since < STROKE_HOLD || fromBat < 12) {
    // The stroke, from the bowler's end: widen and pan with the ball.
    return {
      name: 'stroke',
      pos: { x: ball.x * 0.15, y: (classic ? 4 : 9) + Math.min(10, fromBat * 0.4), z: BOWLER_STUMPS_Z - (classic ? 20 : 36) },
      look: { x: ball.x * 0.8, y: Math.max(0.6, ball.y * 0.7), z: lerp(STRIKER_STUMPS_Z - 1.6, ball.z, 0.8) },
      fov: Math.min(classic ? 45 : 30, (classic ? 20 : 10) + fromBat * 1.1),
      cut: false,
      ease: 5,
    };
  }

  // The chase: a high camera on the boundary, square to the ball's path, framing ball and fielder.
  const side = ball.x >= 0 ? -1 : 1;
  const r = FIELD.boundaryRadius + 12;
  const camZ = Math.max(-r * 0.6, Math.min(r * 0.6, ball.z * 0.5));
  const pos = { x: side * Math.sqrt(Math.max(0, r * r - camZ * camZ)), y: 26, z: camZ };
  const target = input.chaser ? { x: (ball.x + input.chaser.x) / 2, y: 0.8, z: (ball.z + input.chaser.z) / 2 } : { x: ball.x, y: Math.max(0.5, ball.y * 0.8), z: ball.z };
  const spread = input.chaser ? Math.hypot(ball.x - input.chaser.x, ball.z - input.chaser.z) : 0;
  const dist = Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z);
  // Field of view that keeps ball and chaser (plus a margin, and any height of a lofted ball) in frame.
  const span = Math.max(10, spread + 8, ball.y * 1.6 + 6);
  const fov = Math.min(55, Math.max(8, ((2 * Math.atan(span / 2 / dist)) * 180) / Math.PI));
  return { name: 'chase', pos, look: target, fov, cut: input.previous === 'stroke', ease: 3.5 };
}
