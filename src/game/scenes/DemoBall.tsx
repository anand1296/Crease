import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { exposeDebug } from '../debug.ts';
import { FIELD } from '../data/field.ts';
import { type Vec3, lerpVec3, vec3 } from '../core/vec3.ts';
import { DemoBowlingSim } from '../simulation/demoBowling.ts';

/**
 * Renders the P0 demo delivery loop. The simulation owns the truth; this
 * component only interpolates the latest two fixed-step states for display.
 */
export function DemoBall({ seed }: { seed: string }) {
  const mesh = useRef<Mesh>(null);
  const sim = useMemo(() => new DemoBowlingSim(seed), [seed]);
  const scratch = useMemo<Vec3>(() => vec3(), []);
  const steps = useRef(0);

  // Publishing to `window` is a genuine external side effect, so it belongs in an effect.
  useEffect(
    () =>
      exposeDebug({
        ballPosition: () => ({ ...sim.ball.position }),
        deliveryIndex: () => sim.delivery.index,
        simSteps: () => steps.current,
      }),
    [sim],
  );

  useFrame((_, delta) => {
    steps.current += sim.advance(delta);
    const m = mesh.current;
    if (!m) return;
    lerpVec3(scratch, sim.previous, sim.ball.position, sim.clock.alpha);
    m.position.set(scratch.x, scratch.y, scratch.z);
  });

  return (
    <mesh ref={mesh} castShadow>
      <sphereGeometry args={[FIELD.ballRadius, 20, 14]} />
      <meshStandardMaterial color="#b3191e" roughness={0.35} metalness={0.05} />
    </mesh>
  );
}
