import type { Rng } from '../core/rng.ts';
import { type Vec3, length3, vec3 } from '../core/vec3.ts';
import { FIELD } from '../data/field.ts';
import { type Player, offSideSign } from '../model/player.ts';
import { SHOTS, type ShotAttempt, type ShotDef } from './shots.ts';

/**
 * Bat–ball contact.
 *
 * 1. Quality: timing error (as a distance along the ball's path, so quicker
 *    balls are harder) and how far the ball is from where the shot wants it
 *    (line and height), each scaled by the relevant batting attribute.
 * 2. Where on the bat: across the face (middle / edge / miss) and along the
 *    blade (sweet spot / toe / splice), drawn from distributions centred by
 *    the errors above and narrowed by technique and contact quality.
 * 3. Physics: the batter sets the bat face for the ball as they perceive it,
 *    and the impulse model then collides the real ball with that face. The
 *    outgoing velocity therefore depends on the delivery's actual speed,
 *    angle and bounce, not just on the key pressed.
 *
 * All randomness is bounded and shrinks with skill and contact quality.
 */

export type ContactKind = 'middled' | 'mistimed' | 'edge' | 'miss' | 'leave';
export type EdgeKind = 'outside' | 'inside';

export interface ContactInput {
  readonly attempt: ShotAttempt;
  readonly batter: Player;
  /** Ball position and velocity at the moment of contact. */
  readonly ballPosition: Readonly<Vec3>;
  readonly ballVelocity: Readonly<Vec3>;
  /** Seconds the bat arrived after the ball (positive = late, negative = early). */
  readonly timingError: number;
  readonly rng: Rng;
}

export interface ContactResult {
  readonly kind: ContactKind;
  readonly edge?: EdgeKind;
  /** 0–1 overall quality of contact. */
  readonly quality: number;
  /** Timing error normalised by the shot's tolerance (±1 ≈ one tolerance). */
  readonly timing: number;
  /** Positional error normalised by tolerance. */
  readonly reach: number;
  /** Where the ball hit the bat: across the face (+ towards the off-side edge) and along the blade (+ towards the handle), metres from the sweet spot. */
  readonly across: number;
  readonly along: number;
  /** Outgoing velocity (unchanged incoming velocity for a miss or leave). */
  readonly velocity: Vec3;
  readonly exitSpeed: number;
  /** Batter-relative direction and elevation of the outgoing ball, degrees. */
  readonly directionDeg: number;
  readonly elevationDeg: number;
  /** What the batter was trying to do, for feedback and tests. */
  readonly intendedDirectionDeg: number;
  readonly intendedElevationDeg: number;
}

const HALF_BAT = FIELD.batWidth / 2;
const EDGE_START = HALF_BAT - 0.014;
const MISS_BEYOND = HALF_BAT + FIELD.ballRadius;
const MAX_EXIT_SPEED = 52;

/** Distance by which `v` lies outside [min, max] (negative below, positive above, 0 inside). */
export const outside = (v: number, min: number, max: number): number => (v < min ? v - min : v > max ? v - max : 0);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;

/** Batter-relative direction/elevation of a world velocity. */
export function anglesOf(v: Readonly<Vec3>, offSign: number): { directionDeg: number; elevationDeg: number } {
  return {
    directionDeg: Math.atan2(v.x * offSign, -v.z) / DEG,
    elevationDeg: Math.atan2(v.y, Math.hypot(v.x, v.z)) / DEG,
  };
}

/** Unit vector for a batter-relative direction and elevation. */
export function directionVector(directionDeg: number, elevationDeg: number, offSign: number): Vec3 {
  const t = directionDeg * DEG;
  const p = elevationDeg * DEG;
  return vec3(Math.sin(t) * Math.cos(p) * offSign, Math.sin(p), -Math.cos(t) * Math.cos(p));
}

/**
 * Collision of the ball with a bat face moving along its normal `n` at
 * `batSpeed`. The bat is treated as much heavier than the ball: the relative
 * normal velocity is reversed and scaled by `e`; the tangential part is
 * partly retained.
 */
export function collide(u: Readonly<Vec3>, n: Readonly<Vec3>, batSpeed: number, e: number, kt: number): Vec3 | null {
  const rx = u.x - batSpeed * n.x;
  const ry = u.y - batSpeed * n.y;
  const rz = u.z - batSpeed * n.z;
  const un = rx * n.x + ry * n.y + rz * n.z;
  if (un >= 0) return null; // ball moving away from the face: no collision
  const tx = rx - un * n.x;
  const ty = ry - un * n.y;
  const tz = rz - un * n.z;
  return vec3(
    batSpeed * n.x + kt * tx - e * un * n.x,
    batSpeed * n.y + kt * ty - e * un * n.y,
    batSpeed * n.z + kt * tz - e * un * n.z,
  );
}

/**
 * Finds the face orientation that sends a ball arriving with `u` in the
 * target direction. Iterative: aims the face, measures where the ball goes,
 * corrects. Unreachable targets converge to the closest achievable.
 */
export function solveFace(
  u: Readonly<Vec3>,
  targetDir: number,
  targetElev: number,
  batSpeed: number,
  e: number,
  kt: number,
  offSign: number,
): Vec3 {
  let yaw = targetDir;
  let pitch = targetElev;
  let n = directionVector(yaw, pitch, offSign);
  for (let i = 0; i < 14; i++) {
    const out = collide(u, n, batSpeed, e, kt);
    if (!out) {
      // Face turned too far: swing it back towards the bowler.
      yaw *= 0.7;
      n = directionVector(yaw, pitch, offSign);
      continue;
    }
    const a = anglesOf(out, offSign);
    const dYaw = wrapDeg(targetDir - a.directionDeg);
    const dPitch = targetElev - a.elevationDeg;
    if (Math.abs(dYaw) < 0.2 && Math.abs(dPitch) < 0.2) break;
    yaw = clamp(yaw + dYaw * 0.55, -175, 175);
    pitch = clamp(pitch + dPitch * 0.55, -75, 75);
    n = directionVector(yaw, pitch, offSign);
  }
  return n;
}

const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

function rotateYawPitch(v: Readonly<Vec3>, yawRad: number, pitchRad: number): Vec3 {
  // Yaw about +y (positive turns +z towards +x), then raise by pitch.
  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);
  const x = v.x * cy + v.z * sy;
  const z = -v.x * sy + v.z * cy;
  const h = Math.hypot(x, z);
  const elev = Math.atan2(v.y, h) + pitchRad;
  const speed = Math.hypot(h, v.y);
  const hs = Math.cos(elev) * speed;
  return vec3(h > 0 ? (x / h) * hs : 0, Math.sin(elev) * speed, h > 0 ? (z / h) * hs : 0);
}

function noContact(kind: 'miss' | 'leave', u: Readonly<Vec3>, def: ShotDef, quality: number, timing: number, reach: number, across: number, aimDeg: number): ContactResult {
  return {
    kind,
    quality,
    timing,
    reach,
    across,
    along: 0,
    velocity: { ...u },
    exitSpeed: length3(u),
    directionDeg: 180,
    elevationDeg: 0,
    intendedDirectionDeg: aimDeg,
    intendedElevationDeg: def.elevation,
  };
}

export function resolveContact(input: ContactInput): ContactResult {
  const { attempt, batter, rng } = input;
  const def = SHOTS[attempt.shot];
  const aimDeg = attempt.aimDeg ?? def.direction;
  const u = input.ballVelocity;
  if (def.kind === 'leave') return noContact('leave', u, def, 0, 0, 0, 0, aimDeg);

  const off = offSideSign(batter.battingHand);
  const bat = batter.batting;
  const ballSpeed = Math.max(5, length3(u));
  const line = input.ballPosition.x * off;
  const height = input.ballPosition.y;

  // --- 1. Quality ---------------------------------------------------------
  const defensive = def.kind === 'defence';
  const technique = defensive ? (bat.technique + bat.defence) / 2 : bat.technique;
  const timingSkill = defensive ? (bat.timing + bat.defence) / 2 : bat.timing;
  const techTol = 0.7 + 0.6 * (technique / 100);
  const footTol = 0.85 + 0.3 * (bat.footwork / 100);
  const lineTol = 0.16 * techTol * footTol;
  const heightTol = 0.2 * techTol;
  const dLine = outside(line, def.idealLine.min, def.idealLine.max);
  // A ball still dropping onto the toes (a yorker) is far harder to get the
  // bat under than one just bounced up off a full length (a half-volley):
  // count it as lower than it is.
  const yorkedBy = u.y < -1 && height < 0.3 ? 0.3 - height : 0;
  const dHeight = Math.min(outside(height, def.idealHeight.min, def.idealHeight.max), 0) - yorkedBy * 1.3 +
    Math.max(outside(height, def.idealHeight.min, def.idealHeight.max), 0);
  const reach = Math.hypot(dLine / lineTol, dHeight / heightTol);
  const timing = (input.timingError * ballSpeed) / (def.timingTolerance * (0.7 + 0.6 * (timingSkill / 100)));
  const quality = Math.exp(-0.5 * (timing * timing + reach * reach));
  // Spread of execution error: wider for poorer technique and poorer contact.
  const control = 1.35 - 0.6 * (technique / 100);

  // --- 2. Where the ball meets the bat ---------------------------------------
  // Across the face: a ball wider than the shot wants finds the outside edge,
  // one tighter than it wants the inside edge; lateness opens the face.
  const acrossBias = clamp(dLine, -0.3, 0.3) * 0.3 + 0.006 * timing;
  const across = acrossBias + rng.boundedNormal((0.009 + 0.03 * (1 - quality)) * control);
  // Along the blade: balls higher than ideal hit higher on the bat.
  const along = clamp(dHeight, -0.4, 0.4) * 0.3 + rng.boundedNormal((0.02 + 0.08 * (1 - quality)) * control);

  if (Math.abs(timing) > 3.2 || reach > 3.5 || Math.abs(across) > MISS_BEYOND) {
    return noContact('miss', u, def, quality, timing, reach, across, aimDeg);
  }

  const power = 0.75 + 0.55 * (bat.power / 100);
  const intendedElev =
    def.elevation +
    def.riseWithHeightDeg * Math.max(0, height - def.idealHeight.max) -
    def.riseWithHeightDeg * 0.6 * Math.max(0, def.idealHeight.min - height);

  // --- 3a. Edges -------------------------------------------------------------
  if (Math.abs(across) > EDGE_START) {
    const edge: EdgeKind = across > 0 ? 'outside' : 'inside';
    // 1 = thick edge (most of the ball on the bat), 0 = the faintest nick.
    const thickness = clamp((MISS_BEYOND - Math.abs(across)) / (MISS_BEYOND - EDGE_START), 0, 1);
    const deflectDeg = (3 + 32 * thickness * thickness + Math.abs(rng.boundedNormal(4))) * (edge === 'outside' ? 1 : -1);
    const liftDeg = rng.boundedNormal(9) + along * 40;
    const keep = 0.35 + 0.3 * thickness;
    const deflected = rotateYawPitch(u, deflectDeg * DEG * off, liftDeg * DEG);
    const push = directionVector(aimDeg, intendedElev, off);
    const batPush = def.batSpeed * power * 0.35 * thickness;
    const v = vec3(
      deflected.x * keep + push.x * batPush,
      deflected.y * keep + push.y * batPush,
      deflected.z * keep + push.z * batPush,
    );
    const a = anglesOf(v, off);
    return {
      kind: 'edge', edge, quality: quality * 0.4, timing, reach, across, along,
      velocity: v, exitSpeed: length3(v), directionDeg: a.directionDeg, elevationDeg: a.elevationDeg,
      intendedDirectionDeg: aimDeg, intendedElevationDeg: intendedElev,
    };
  }

  // --- 3b. Middle of the bat (clean or mistimed) -----------------------------
  const sweet = clamp(1 - 2.2 * Math.abs(along), 0.35, 1) * (1 - 0.35 * (Math.abs(across) / EDGE_START) ** 2);
  const e = def.restitution * sweet;
  // Digging out a yorker: the bat comes down steeply with little room to swing.
  const batSpeed = def.batSpeed * power * (0.6 + 0.4 * quality) * (1 - Math.min(0.5, yorkedBy * 2));
  const kt = def.tangentialRetention;

  const direction =
    aimDeg + def.lateDirection * timing * def.timingTurnDeg + rng.boundedNormal((1.5 + 9 * (1 - quality)) * control);
  const elevation =
    intendedElev + along * 70 + rng.boundedNormal((1 + 6 * (1 - quality)) * control) - Math.abs(timing) * 2;

  // The batter sets the face for the ball they perceive: its pace always,
  // its angle and movement only as well as their technique reads it.
  const read = 0.3 + 0.6 * (technique / 100);
  const straight = vec3(0, 0, ballSpeed);
  const perceived = vec3(
    straight.x + (u.x - straight.x) * read,
    straight.y + (u.y - straight.y) * read,
    straight.z + (u.z - straight.z) * read,
  );
  const face = solveFace(perceived, direction, elevation, batSpeed, e, kt, off);
  const out = collide(u, face, batSpeed, e, kt) ?? vec3(u.x * -0.2, Math.abs(u.y) * 0.2, -u.z * 0.2);
  const speed = length3(out);
  const v = speed > MAX_EXIT_SPEED ? vec3((out.x / speed) * MAX_EXIT_SPEED, (out.y / speed) * MAX_EXIT_SPEED, (out.z / speed) * MAX_EXIT_SPEED) : out;
  const a = anglesOf(v, off);
  return {
    kind: quality > 0.6 ? 'middled' : 'mistimed',
    quality,
    timing,
    reach,
    across,
    along,
    velocity: v,
    exitSpeed: length3(v),
    directionDeg: a.directionDeg,
    elevationDeg: a.elevationDeg,
    intendedDirectionDeg: aimDeg,
    intendedElevationDeg: intendedElev,
  };
}
