import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { STANDARD_FIELD, fieldPositionXZ } from '../data/fieldPositions.ts';

/**
 * Stylised placeholder players (capsule body + head). Replaced by the
 * animated rigs in P4; positions are already driven by the field data.
 */
function Figure({ x, z, kit, cap = '#1d2a44' }: { x: number; z: number; kit: string; cap?: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.85, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.95, 4, 12]} />
        <meshStandardMaterial color={kit} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color="#b98a66" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.7, 0]}>
        <sphereGeometry args={[0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={cap} roughness={0.7} />
      </mesh>
    </group>
  );
}

const BATTING_KIT = '#f3f1ea';
const FIELDING_KIT = '#2f6db5';

export function Figures() {
  return (
    <group>
      {/* Striker, standing leg side of middle stump at the popping crease. */}
      <Figure x={-0.35} z={STRIKER_STUMPS_Z - 1.0} kit={BATTING_KIT} cap="#7a1f2b" />
      {/* Non-striker, backing up. */}
      <Figure x={-1.6} z={BOWLER_STUMPS_Z + 1.2} kit={BATTING_KIT} cap="#7a1f2b" />
      {/* Bowler, wide of the stumps so the broadcast camera can see past him. */}
      <Figure x={1.3} z={BOWLER_STUMPS_Z - 2.5} kit={FIELDING_KIT} />
      {STANDARD_FIELD.map((pos) => {
        const { x, z } = fieldPositionXZ(pos);
        return <Figure key={pos.id} x={x} z={z} kit={FIELDING_KIT} />;
      })}
    </group>
  );
}
