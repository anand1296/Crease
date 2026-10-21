import { FIELD } from '../data/field.ts';

const STUMP_SPACING = (FIELD.wicketWidth - FIELD.stumpRadius * 2) / 2;

/** Three stumps and two bails, base centred at (0, 0, z). */
export function Stumps({ z }: { z: number }) {
  const h = FIELD.stumpHeight;
  return (
    <group position={[0, 0, z]}>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[i * STUMP_SPACING, h / 2, 0]} castShadow>
          <cylinderGeometry args={[FIELD.stumpRadius, FIELD.stumpRadius, h, 12]} />
          <meshStandardMaterial color="#efe6cf" roughness={0.6} />
        </mesh>
      ))}
      {[-0.5, 0.5].map((i) => (
        <mesh key={i} position={[i * STUMP_SPACING, h + 0.008, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.007, 0.007, FIELD.bailLength, 8]} />
          <meshStandardMaterial color="#efe6cf" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
