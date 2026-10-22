import { describe, expect, it } from 'vitest';
import { CHASE_CAMERAS, STROKE_HOLD, TIGHT, WIDE, chaseCamera, direct, type DirectorInput } from './director.ts';
import { STRIKER_STUMPS_Z } from '../../data/field.ts';

const base: DirectorInput = {
  phase: 'runUp',
  time: 0,
  releaseTime: 1.7,
  contactTime: undefined,
  stumpsTime: undefined,
  ball: undefined,
  chaser: undefined,
  previous: undefined,
};

describe('camera director', () => {
  it('between balls, holds the wide shot from behind the bowler', () => {
    const s = direct({ ...base, phase: undefined });
    expect(s.name).toBe('wide');
    expect(s.fov).toBe(WIDE.fov);
  });

  it('pushes in steadily through the run-up and is tight on the striker by release', () => {
    let prev = direct({ ...base, time: 0 });
    expect(prev.fov).toBeCloseTo(WIDE.fov, 5);
    for (let t = 0.1; t <= 1.7; t += 0.1) {
      const s = direct({ ...base, time: t });
      expect(s.fov).toBeLessThanOrEqual(prev.fov + 1e-9);
      expect(s.pos.z).toBeGreaterThanOrEqual(prev.pos.z - 1e-9);
      expect(s.cut).toBe(false);
      prev = s;
    }
    expect(prev.fov).toBeCloseTo(TIGHT.fov, 5);
    expect(prev.look.z).toBeCloseTo(TIGHT.look.z, 5);
  });

  it('shows the stroke, then cuts to a chase camera that frames the ball and fielder', () => {
    const ball = { x: 18, y: 0.5, z: -10 };
    const stroke = direct({ ...base, phase: 'struck', time: 3, contactTime: 3 - STROKE_HOLD / 2, ball, previous: 'delivery' });
    expect(stroke.name).toBe('stroke');
    const chase = direct({ ...base, phase: 'struck', time: 4, contactTime: 3, ball, chaser: { x: 25, y: 0, z: -14 }, previous: 'stroke' });
    expect(chase.name).toBe('chase');
    expect(chase.cut).toBe(true);
    // Camera on the opposite side of the ground to the ball, looking between ball and fielder.
    expect(Math.sign(chase.pos.x)).toBe(-1);
    expect(chase.look.x).toBeCloseTo(21.5, 5);
    const steady = direct({ ...base, phase: 'struck', time: 4.1, contactTime: 3, ball, chaser: { x: 25, y: 0, z: -14 }, previous: 'chase' });
    expect(steady.cut).toBe(false);
  });

  it('cuts to the stumps when the wicket is broken', () => {
    const s = direct({ ...base, phase: 'dead', time: 3, stumpsTime: 2.5, ball: { x: 0, y: 0.3, z: STRIKER_STUMPS_Z }, previous: 'delivery' });
    expect(s.name).toBe('stumps');
    expect(s.cut).toBe(true);
    expect(s.look.z).toBeCloseTo(STRIKER_STUMPS_Z, 5);
  });

  it('stays tight on a ball that is left, missed or padded', () => {
    const s = direct({ ...base, phase: 'dead', time: 2.6, ball: { x: 0.2, y: 0.8, z: STRIKER_STUMPS_Z + 1 } });
    expect(s.name).toBe('delivery');
  });

  it('television: a long-lens close-up of the batter between balls, then a cut to the main camera as the bowler runs in', () => {
    const close = direct({ ...base, phase: undefined, subject: { x: -0.45, y: 0, z: 9.3 }, previous: 'chase' });
    expect(close.name).toBe('closeUp');
    expect(close.cut).toBe(true);
    expect(close.fov).toBeLessThan(5);
    const run = direct({ ...base, time: 0, previous: 'closeUp' });
    expect(run.name).toBe('runUp');
    expect(run.cut).toBe(true);
    // The main camera is far back and high: a broadcast long lens.
    expect(WIDE.pos.z).toBeLessThan(-70);
    expect(TIGHT.fov).toBeLessThan(7);
  });

  it('chases from the fixed camera looking across at the ball, and stays on it', () => {
    expect(chaseCamera({ x: 30, y: 0, z: -5 })).toBe('squareMinus');
    expect(chaseCamera({ x: -30, y: 0, z: -5 })).toBe('squarePlus');
    expect(chaseCamera({ x: 2, y: 0, z: -40 })).toBe('reverse');
    expect(chaseCamera({ x: 20, y: 0, z: 20 })).toBe('main');
    const first = direct({ ...base, phase: 'struck', time: 4, contactTime: 3, ball: { x: 30, y: 1, z: -5 }, previous: 'stroke' });
    expect(first.cam).toBe('squareMinus');
    expect(first.pos).toEqual(CHASE_CAMERAS.squareMinus);
    // The ball runs on behind square: the director stays on the same camera.
    const later = direct({ ...base, phase: 'struck', time: 5, contactTime: 3, ball: { x: 30, y: 0.1, z: 15 }, previous: 'chase', previousCam: first.cam });
    expect(later.cam).toBe('squareMinus');
  });
});
