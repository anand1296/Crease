import { forwardRef } from 'react';
import type { Group } from 'three';

/**
 * Stylised player: capsule body, head and cap, built from primitives (no
 * external assets). Positioned imperatively by the views every frame.
 */
export const PlayerFigure = forwardRef<Group, { kit: string; cap: string; skin?: string }>(function PlayerFigure(
  { kit, cap, skin = '#b98a66' },
  ref,
) {
  return (
    <group ref={ref}>
      <mesh position={[0, 0.85, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.95, 4, 12]} />
        <meshStandardMaterial color={kit} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.66, 0]}>
        <sphereGeometry args={[0.137, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={cap} roughness={0.7} />
      </mesh>
    </group>
  );
});
