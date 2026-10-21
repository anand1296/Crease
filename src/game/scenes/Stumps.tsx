import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { Group, Mesh } from 'three';
import { FIELD } from '../data/field.ts';

const STUMP_SPACING = (FIELD.wicketWidth - FIELD.stumpRadius * 2) / 2;
const GRAVITY = 9.81;

/** Lets a view knock the wicket over and put it back. */
export interface WicketHandle {
  /**
   * Breaks the wicket: `push` is the direction it was hit from (+1 = the ball
   * travelling towards +z), `strength` 0–1, `seed` varies how the bails fly.
   */
  break(push: 1 | -1, strength: number, seed: number): void;
  reset(): void;
  /** Advances the flying bails and the falling stumps. */
  step(dt: number): void;
}

interface WicketState {
  broken: boolean;
  lean: number[];
  leanTarget: number[];
  bails: Bail[];
}

interface Bail {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  angle: number;
  resting: boolean;
}

/** Three stumps and two bails, base centred at (0, 0, z). */
export const Stumps = forwardRef<WicketHandle, { z: number }>(function Stumps({ z }, ref) {
  const h = FIELD.stumpHeight;
  const stumps = useRef<(Group | null)[]>([]);
  const bails = useRef<(Mesh | null)[]>([]);
  const state = useMemo<WicketState>(
    () => ({
      broken: false,
      lean: [0, 0, 0],
      leanTarget: [0, 0, 0],
      bails: [-0.5, 0.5].map((i) => ({ x: i * STUMP_SPACING, y: h + 0.008, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, angle: 0, resting: true })),
    }),
    [h],
  );

  const handle = useMemo<WicketHandle>(() => {
    const apply = () => {
      stumps.current.forEach((g, i) => {
        if (g) g.rotation.x = state.lean[i] ?? 0;
      });
      bails.current.forEach((m, i) => {
        const b = state.bails[i];
        if (!m || !b) return;
        m.position.set(b.x, b.y, b.z);
        m.rotation.set(b.angle, 0, Math.PI / 2);
      });
    };
    return {
      break(push, strength, seed) {
        if (state.broken) return;
        state.broken = true;
        const r = (k: number) => {
          const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        const s = 0.5 + 0.5 * Math.min(1, Math.max(0, strength));
        // The stump that was hit goes back furthest; its neighbours rock.
        const hit = Math.floor(r(1) * 3);
        state.leanTarget = [0, 1, 2].map((i) => push * (i === hit ? 0.55 : 0.12 + 0.2 * r(i + 2)) * s);
        state.bails.forEach((b, i) => {
          b.resting = false;
          b.vx = (r(i + 10) - 0.5) * 3 * s;
          b.vy = (2 + 2.5 * r(i + 20)) * s;
          b.vz = push * (2.5 + 4 * r(i + 30)) * s;
          b.spin = (r(i + 40) - 0.5) * 40;
        });
      },
      reset() {
        state.broken = false;
        state.lean = [0, 0, 0];
        state.leanTarget = [0, 0, 0];
        state.bails.forEach((b, i) => {
          b.x = (i === 0 ? -0.5 : 0.5) * STUMP_SPACING;
          b.y = h + 0.008;
          b.z = 0;
          b.vx = b.vy = b.vz = 0;
          b.angle = 0;
          b.spin = 0;
          b.resting = true;
        });
        apply();
      },
      step(dt) {
        if (!state.broken) return;
        state.lean = state.lean.map((l, i) => l + ((state.leanTarget[i] ?? 0) - l) * Math.min(1, dt * 18));
        for (const b of state.bails) {
          if (b.resting) continue;
          b.vy -= GRAVITY * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
          b.angle += b.spin * dt;
          if (b.y <= 0.01) {
            b.y = 0.01;
            if (Math.abs(b.vy) < 1) {
              b.resting = true;
              b.angle = Math.PI / 2;
            } else {
              b.vy = -b.vy * 0.3;
              b.vx *= 0.5;
              b.vz *= 0.5;
              b.spin *= 0.5;
            }
          }
        }
        apply();
      },
    };
  }, [state, h]);
  useImperativeHandle(ref, () => handle, [handle]);

  return (
    <group position={[0, 0, z]}>
      {[-1, 0, 1].map((i, k) => (
        <group
          key={i}
          position={[i * STUMP_SPACING, 0, 0]}
          ref={(g) => {
            stumps.current[k] = g;
          }}
        >
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[FIELD.stumpRadius, FIELD.stumpRadius * 0.92, h, 14]} />
            <meshStandardMaterial color="#efe6cf" roughness={0.45} />
          </mesh>
        </group>
      ))}
      {[-0.5, 0.5].map((i, k) => (
        <mesh
          key={i}
          position={[i * STUMP_SPACING, h + 0.008, 0]}
          rotation-z={Math.PI / 2}
          castShadow
          ref={(m) => {
            bails.current[k] = m;
          }}
        >
          <cylinderGeometry args={[0.007, 0.007, FIELD.bailLength, 8]} />
          <meshStandardMaterial color="#efe6cf" roughness={0.45} />
        </mesh>
      ))}
    </group>
  );
});
