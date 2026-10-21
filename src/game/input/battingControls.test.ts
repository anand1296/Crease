import { describe, expect, it } from 'vitest';
import { ALL_SHOTS, SHOTS, type ShotId } from '../batting/shots.ts';
import { type BatAction, type ScreenDirection, shotFromInput, sideOf } from './battingControls.ts';

const D = (x: -1 | 0 | 1, y: -1 | 0 | 1): ScreenDirection => ({ x, y });

describe('batting controls', () => {
  it('screen-left is the off side for a right-hander and the leg side for a left-hander', () => {
    expect(sideOf(-1, 'right')).toBe('off');
    expect(sideOf(-1, 'left')).toBe('leg');
    expect(sideOf(1, 'right')).toBe('leg');
  });

  it('maps the main strokes', () => {
    expect(shotFromInput('ground', D(0, 0), false, 'right').shot).toBe('straightDrive');
    expect(shotFromInput('ground', D(-1, 0), false, 'right').shot).toBe('coverDrive');
    expect(shotFromInput('ground', D(-1, 0), true, 'right').shot).toBe('squareCut');
    expect(shotFromInput('ground', D(1, 0), true, 'right').shot).toBe('pull');
    expect(shotFromInput('ground', D(-1, 0), false, 'left').shot).toBe('flick');
    expect(shotFromInput('defend', D(0, 0), true, 'right')).toEqual({ shot: 'block', footwork: 'back' });
    expect(shotFromInput('sweep', D(-1, 0), false, 'right').shot).toBe('reverseSweep');
    expect(shotFromInput('loft', D(1, 0), true, 'right').shot).toBe('hook');
  });

  it('aims lofted shots into the direction pressed, on the correct side for each hand', () => {
    const rh = shotFromInput('loft', D(-1, 0), false, 'right');
    const lh = shotFromInput('loft', D(-1, 0), false, 'left');
    expect(rh.shot).toBe('loftedAttack');
    expect(rh.aimDeg ?? 0).toBeGreaterThan(0);
    expect(lh.aimDeg ?? 0).toBeLessThan(0);
  });

  it('every one of the 16 strokes is reachable from the keyboard', () => {
    const reached = new Set<ShotId>();
    const actions: BatAction[] = ['ground', 'loft', 'defend', 'sweep', 'leave'];
    for (const action of actions) {
      for (const x of [-1, 0, 1] as const) {
        for (const y of [-1, 0, 1] as const) {
          for (const back of [false, true]) reached.add(shotFromInput(action, D(x, y), back, 'right').shot);
        }
      }
    }
    expect([...reached].sort()).toEqual([...ALL_SHOTS].sort());
  });

  it('never asks for footwork a stroke does not have', () => {
    for (const action of ['ground', 'loft', 'defend', 'sweep', 'leave'] as const) {
      for (const x of [-1, 0, 1] as const) {
        for (const y of [-1, 0, 1] as const) {
          for (const back of [false, true]) {
            const a = shotFromInput(action, D(x, y), back, 'right');
            expect(SHOTS[a.shot].footwork.includes(a.footwork)).toBe(true);
          }
        }
      }
    }
  });
});
