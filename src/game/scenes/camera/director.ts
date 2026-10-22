import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../../data/field.ts';

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
  readonly name: 'wide' | 'aim' | 'closeUp' | 'runUp' | 'delivery' | 'stroke' | 'chase' | 'stumps' | 'hold';
  /** Which fixed camera a chase shot uses (so the director stays on it for the rest of the ball). */
  readonly cam?: string;
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
  /** Between balls on television: who to show in close-up (the striker), if anyone. */
  readonly subject?: Vec | undefined;
  /** The fixed camera the previous chase shot used. */
  readonly previousCam?: string | undefined;
}

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The television main camera: high in the stand behind the bowler's arm on a
 * long lens (≈70 m back, 17 m up), which is what gives broadcast cricket its
 * compressed look — the pitch short and steep, the players large. Between
 * balls it shows the whole pitch and the close field.
 */
export const WIDE: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: 0, y: 17, z: BOWLER_STUMPS_Z - 70 },
  look: { x: 0, y: 0.6, z: 1.5 },
  fov: 10,
};
/** The same camera zoomed in through the run-up: by release, the bowler at the foot of the frame and the batter at the top. */
export const TIGHT: Readonly<{ pos: Vec; look: Vec; fov: number }> = {
  pos: { x: 0, y: 15.5, z: BOWLER_STUMPS_Z - 66 },
  look: { x: 0, y: 1.0, z: STRIKER_STUMPS_Z - 3.5 },
  fov: 6.2,
};

/**
 * The fixed cameras the director cuts to after the ball is hit, as on
 * television: high in the stands square of the wicket on either side, and
 * high at the keeper's end for the ball hit straight. The one used is the
 * one looking across the ground at where the ball is going, and it stays on
 * it for the rest of the ball.
 */
export const CHASE_CAMERAS: Readonly<Record<string, Vec>> = {
  // On gantries at the front of the stands (r ≈ 82 m), under the roof.
  squarePlus: { x: 82, y: 15, z: -4 },
  squareMinus: { x: -82, y: 15, z: -4 },
  reverse: { x: 0, y: 15, z: STRIKER_STUMPS_Z + 72 },
  main: { x: 0, y: 17, z: BOWLER_STUMPS_Z - 70 },
};

/** Picks the fixed camera for a ball travelling to `ball` (from the striker). */
export function chaseCamera(ball: Vec): string {
  const dz = ball.z - STRIKER_STUMPS_Z;
  // Behind square: the main camera looks straight at it.
  if (dz > -4) return 'main';
  // Straight down the ground: from the keeper's end.
  if (Math.abs(ball.x) < Math.abs(dz) * 0.42) return 'reverse';
  // Square: from across the ground.
  return ball.x >= 0 ? 'squareMinus' : 'squarePlus';
}

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
    // Television, between balls: a long-lens close-up of the batter.
    if (!classic && !input.humanBowling && input.subject) {
      const sub = input.subject;
      return {
        name: 'closeUp',
        // High enough that the background is outfield grass, not the advertising boards.
        pos: { x: sub.x + 9, y: 9, z: BOWLER_STUMPS_Z - 40 },
        look: { x: sub.x, y: 1.3, z: sub.z },
        fov: 3.4,
        cut: input.previous !== 'closeUp',
        ease: 4,
      };
    }
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
      // From the close-up, cut back to the main camera as the bowler sets off.
      cut: input.previous === 'closeUp' || input.previous === 'chase' || input.previous === 'stumps',
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
    if (!classic) {
      // Television: the main camera operator stays on his tripod, pans with the ball and zooms out.
      return {
        name: 'stroke',
        pos: { ...TIGHT.pos },
        look: { x: ball.x * 0.85, y: Math.max(0.6, ball.y * 0.75), z: lerp(STRIKER_STUMPS_Z - 3, ball.z, 0.85) },
        fov: Math.min(22, TIGHT.fov + fromBat * 0.75 + ball.y * 0.4),
        cut: false,
        ease: 6,
      };
    }
    // The stroke, from the bowler's end: widen and pan with the ball.
    return {
      name: 'stroke',
      pos: { x: ball.x * 0.15, y: 4 + Math.min(10, fromBat * 0.4), z: BOWLER_STUMPS_Z - 20 },
      look: { x: ball.x * 0.8, y: Math.max(0.6, ball.y * 0.7), z: lerp(STRIKER_STUMPS_Z - 1.6, ball.z, 0.8) },
      fov: Math.min(45, 20 + fromBat * 1.1),
      cut: false,
      ease: 5,
    };
  }

  // The chase: a fixed high camera looking across the ground at the ball, framing ball and fielder.
  const cam = input.previous === 'chase' && input.previousCam ? input.previousCam : chaseCamera(ball);
  const fixed = CHASE_CAMERAS[cam] ?? CHASE_CAMERAS.squareMinus ?? { x: -88, y: 26, z: -4 };
  const pos = { ...fixed };
  const target = input.chaser ? { x: (ball.x + input.chaser.x) / 2, y: 0.8, z: (ball.z + input.chaser.z) / 2 } : { x: ball.x, y: Math.max(0.5, ball.y * 0.8), z: ball.z };
  const spread = input.chaser ? Math.hypot(ball.x - input.chaser.x, ball.z - input.chaser.z) : 0;
  const dist = Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z);
  // Field of view that keeps ball and chaser (plus a margin, and any height of a lofted ball) in frame.
  // Tight on the fielder, as television is: just the ball, the man going for it, and a little room.
  const span = Math.max(6.5, spread + 5, ball.y * 1.6 + 4);
  const fov = Math.min(55, Math.max(8, ((2 * Math.atan(span / 2 / dist)) * 180) / Math.PI));
  return { name: 'chase', cam, pos, look: target, fov, cut: input.previous === 'stroke', ease: 4.5 };
}
