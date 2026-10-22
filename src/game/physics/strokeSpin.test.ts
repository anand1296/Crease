import { describe, expect, it } from 'vitest';
import { strokeSpin } from '../batting/contact.ts';
import { STRIKER_STUMPS_Z } from '../data/field.ts';
import { createBall, newStepEvents, stepBall } from './ball.ts';

function roll(curl: number, carry: number, vx: number, vz: number, vy = 0) {
  const b = createBall({ x: 0, y: vy > 0 ? 0.6 : 0.036, z: STRIKER_STUMPS_Z - 1 }, { x: vx, y: vy, z: vz });
  b.movement.curl = curl;
  b.movement.carry = carry;
  const ev = newStepEvents();
  for (let i = 0; i < 240 * 8 && !b.atRest; i++) stepBall(b, 1 / 240, undefined, ev);
  return b.position;
}

describe('spin off the bat', () => {
  it('a cut runs away finer (towards third man), more when played late', () => {
    // Right-hander (off side +x): a square cut along the ground.
    const plain = roll(0, 0, 20, 0);
    const cut = strokeSpin('squareCut', 'middled', 0, 1, 0.5);
    const late = strokeSpin('squareCut', 'middled', 1, 1, 0.5);
    const p1 = roll(cut.curl, cut.carry, 20, 0);
    const p2 = roll(late.curl, late.carry, 20, 0);
    // Finer = further behind the batter (+z).
    expect(p1.z).toBeGreaterThan(plain.z + 1);
    expect(p2.z).toBeGreaterThan(p1.z);
    // And a little shorter for the backspin.
    expect(Math.hypot(p1.x, p1.z - plain.z)).toBeLessThan(Math.hypot(plain.x, 0) + 0.5);
  });

  it('mirrors for a left-hander', () => {
    const cut = strokeSpin('squareCut', 'middled', 0, -1, 0.5);
    const p = roll(cut.curl, cut.carry, -20, 0);
    expect(p.z).toBeGreaterThan(STRIKER_STUMPS_Z - 1 + 1);
  });

  it('a flick bends finer on the leg side; a drive with topspin runs on further than one without', () => {
    const flick = strokeSpin('flick', 'middled', 0, 1, 0.5);
    const p = roll(flick.curl, flick.carry, -18, -6);
    const plain = roll(0, 0, -18, -6);
    expect(p.z).toBeGreaterThan(plain.z);
    const drive = strokeSpin('coverDrive', 'middled', 0, 1, 0.5);
    // Lofted a little so it bounces.
    const run = roll(drive.curl, drive.carry, 6, -18, 3);
    const dead = roll(0, 0, 6, -18, 3);
    expect(Math.hypot(run.x, run.z)).toBeGreaterThan(Math.hypot(dead.x, dead.z));
  });
});
