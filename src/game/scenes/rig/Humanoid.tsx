import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { type Group, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Articulated cricketer built from primitives (no external assets):
 * hips → torso → neck/head, shoulders → upper arm → elbow → forearm → hand,
 * hips → thigh → knee → shin → foot. Kit colours per team; helmet, pads and
 * gloves for batters; pads and big gloves for the keeper.
 *
 * Posed imperatively each frame through the handle's `apply(pose)`, so a
 * view can animate twenty-two players without React re-renders.
 */
export interface Kit {
  readonly shirt: string;
  readonly trim: string;
  readonly trousers: string;
  readonly skin: string;
  readonly headwear: 'helmet' | 'cap' | 'hat';
  readonly pads: boolean;
  readonly gloves: 'batting' | 'keeping' | 'none';
}

export interface LimbPose {
  /** Forward swing, radians (arm: raise forward; leg: thigh forward). */
  pitch: number;
  /** Outward swing away from the body, radians. */
  roll: number;
  /** Elbow or knee bend, radians (always positive). */
  bend: number;
}

export interface Pose {
  /** Root position (feet on the ground at y = 0) and facing (0 = towards +z, the striker's end). */
  x: number;
  z: number;
  facing: number;
  /** Lowers the hips (crouch), metres. */
  drop: number;
  /** Vertical bounce (running), metres. */
  bob: number;
  /** Torso lean forward and twist, radians. */
  lean: number;
  twist: number;
  /** Sideways tilt of the torso, radians. */
  tilt: number;
  armL: LimbPose;
  armR: LimbPose;
  legL: LimbPose;
  legR: LimbPose;
  /** Optional world-space hand targets: the arm is aimed at them (e.g. holding a bat). */
  handL?: Vector3 | undefined;
  handR?: Vector3 | undefined;
}

const limb = (pitch = 0, roll = 0, bend = 0): LimbPose => ({ pitch, roll, bend });

export function neutralPose(): Pose {
  return {
    x: 0, z: 0, facing: 0, drop: 0, bob: 0, lean: 0, twist: 0, tilt: 0,
    armL: limb(0, 0.08, 0.15), armR: limb(0, 0.08, 0.15), legL: limb(), legR: limb(),
  };
}

export interface HumanoidHandle {
  readonly root: Group | null;
  apply(pose: Pose): void;
  /** World position of the right (or left) hand, written into `out`. */
  handWorld(side: 'L' | 'R', out: Vector3): Vector3;
}

// Proportions (metres).
const HIP_Y = 0.94;
const THIGH = 0.45;
const SHIN = 0.44;
const TORSO = 0.52;
const SHOULDER_X = 0.2;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;
const HIP_X = 0.1;

const DOWN = new Vector3(0, -1, 0);
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();

function Limb({
  upperLen,
  lowerLen,
  upperRadius,
  lowerRadius,
  upperColor,
  lowerColor,
  endColor,
  endSize,
  upperRef,
  lowerRef,
  endRef,
  pads,
}: {
  upperLen: number;
  lowerLen: number;
  upperRadius: number;
  lowerRadius: number;
  upperColor: string;
  lowerColor: string;
  endColor: string;
  endSize: [number, number, number];
  upperRef: React.RefObject<Group | null>;
  lowerRef: React.RefObject<Group | null>;
  endRef: React.RefObject<Group | null>;
  pads?: boolean;
}) {
  return (
    <group ref={upperRef}>
      <mesh position={[0, -upperLen / 2, 0]} castShadow>
        <capsuleGeometry args={[upperRadius, upperLen - upperRadius * 1.2, 3, 8]} />
        <meshStandardMaterial color={upperColor} roughness={0.85} />
      </mesh>
      {pads ? (
        <mesh position={[0, -upperLen + 0.08, 0.06]}>
          <boxGeometry args={[0.15, 0.16, 0.06]} />
          <meshStandardMaterial color="#f3f1ea" roughness={0.7} />
        </mesh>
      ) : null}
      <group ref={lowerRef} position={[0, -upperLen, 0]}>
        <mesh position={[0, -lowerLen / 2, 0]} castShadow>
          <capsuleGeometry args={[lowerRadius, lowerLen - lowerRadius * 1.2, 3, 8]} />
          <meshStandardMaterial color={lowerColor} roughness={0.85} />
        </mesh>
        {pads ? (
          <mesh position={[0, -lowerLen / 2, 0.05]}>
            <boxGeometry args={[0.15, lowerLen * 0.95, 0.07]} />
            <meshStandardMaterial color="#f3f1ea" roughness={0.7} />
          </mesh>
        ) : null}
        <group ref={endRef} position={[0, -lowerLen, 0]}>
          <mesh position={[0, -endSize[1] / 2, endSize[2] * 0.25]}>
            <boxGeometry args={endSize} />
            <meshStandardMaterial color={endColor} roughness={0.75} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export const Humanoid = forwardRef<HumanoidHandle, { kit: Kit }>(function Humanoid({ kit }, ref) {
  const root = useRef<Group>(null);
  const hips = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const shoulderL = useRef<Group>(null);
  const shoulderR = useRef<Group>(null);
  const elbowL = useRef<Group>(null);
  const elbowR = useRef<Group>(null);
  const handL = useRef<Group>(null);
  const handR = useRef<Group>(null);
  const hipL = useRef<Group>(null);
  const hipR = useRef<Group>(null);
  const kneeL = useRef<Group>(null);
  const kneeR = useRef<Group>(null);
  const footL = useRef<Group>(null);
  const footR = useRef<Group>(null);

  const handle = useMemo<HumanoidHandle>(
    () => ({
      get root() {
        return root.current;
      },
      apply(p: Pose) {
        const r = root.current;
        const h = hips.current;
        const t = torso.current;
        if (!r || !h || !t) return;
        r.position.set(p.x, 0, p.z);
        r.rotation.y = p.facing;
        h.position.y = HIP_Y - p.drop + p.bob;
        t.rotation.set(p.lean, p.twist, p.tilt, 'YXZ');
        setLeg(hipL.current, kneeL.current, footL.current, p.legL, 1);
        setLeg(hipR.current, kneeR.current, footR.current, p.legR, -1);
        if (p.handL || p.handR) r.updateMatrixWorld(true);
        setArm(shoulderL.current, elbowL.current, p.armL, 1, p.handL);
        setArm(shoulderR.current, elbowR.current, p.armR, -1, p.handR);
      },
      handWorld(side, out) {
        const hand = side === 'L' ? handL.current : handR.current;
        if (!hand) return out.set(0, 0, 0);
        hand.updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(hand.matrixWorld);
      },
    }),
    [],
  );
  useImperativeHandle(ref, () => handle, [handle]);

  const glove = kit.gloves === 'keeping' ? '#d8cfb9' : kit.gloves === 'batting' ? '#f2efe6' : kit.skin;
  const gloveSize: [number, number, number] = kit.gloves === 'keeping' ? [0.12, 0.14, 0.09] : kit.gloves === 'batting' ? [0.1, 0.11, 0.08] : [0.07, 0.09, 0.05];

  return (
    <group ref={root}>
      <group ref={hips} position={[0, HIP_Y, 0]}>
        {/* Pelvis */}
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.32, 0.18, 0.2]} />
          <meshStandardMaterial color={kit.trousers} roughness={0.85} />
        </mesh>
        <group ref={torso}>
          {/* Chest and stomach */}
          <mesh position={[0, TORSO * 0.55, 0]} castShadow>
            <capsuleGeometry args={[0.17, TORSO * 0.6, 4, 10]} />
            <meshStandardMaterial color={kit.shirt} roughness={0.8} />
          </mesh>
          {/* Shirt trim across the chest */}
          <mesh position={[0, TORSO * 0.72, 0.13]}>
            <boxGeometry args={[0.3, 0.06, 0.06]} />
            <meshStandardMaterial color={kit.trim} roughness={0.8} />
          </mesh>
          {/* Neck and head */}
          <mesh position={[0, TORSO + 0.08, 0]}>
            <cylinderGeometry args={[0.05, 0.055, 0.1, 8]} />
            <meshStandardMaterial color={kit.skin} roughness={0.75} />
          </mesh>
          <group position={[0, TORSO + 0.22, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.105, 16, 12]} />
              <meshStandardMaterial color={kit.skin} roughness={0.7} />
            </mesh>
            {kit.headwear === 'helmet' ? (
              <>
                <mesh position={[0, 0.02, -0.005]}>
                  <sphereGeometry args={[0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.45} metalness={0.2} />
                </mesh>
                {/* Peak and grille */}
                <mesh position={[0, 0.03, 0.12]} rotation-x={0.25}>
                  <boxGeometry args={[0.18, 0.012, 0.07]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.5} />
                </mesh>
                <mesh position={[0, -0.04, 0.105]}>
                  <torusGeometry args={[0.1, 0.007, 4, 16, Math.PI]} />
                  <meshStandardMaterial color="#9aa0a8" metalness={0.8} roughness={0.3} />
                </mesh>
              </>
            ) : kit.headwear === 'hat' ? (
              <>
                <mesh position={[0, 0.05, 0]}>
                  <cylinderGeometry args={[0.1, 0.11, 0.08, 14]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.8} />
                </mesh>
                <mesh position={[0, 0.015, 0]}>
                  <cylinderGeometry args={[0.18, 0.18, 0.012, 18]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.8} />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[0, 0.03, 0]}>
                  <sphereGeometry args={[0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.75} />
                </mesh>
                <mesh position={[0, 0.03, 0.1]} rotation-x={0.1}>
                  <boxGeometry args={[0.16, 0.012, 0.09]} />
                  <meshStandardMaterial color={kit.trim} roughness={0.75} />
                </mesh>
              </>
            )}
          </group>
          {/* Arms */}
          <group position={[SHOULDER_X, TORSO * 0.88, 0]}>
            <Limb
              upperLen={UPPER_ARM} lowerLen={FOREARM} upperRadius={0.05} lowerRadius={0.04}
              upperColor={kit.shirt} lowerColor={kit.skin} endColor={glove} endSize={gloveSize}
              upperRef={shoulderL} lowerRef={elbowL} endRef={handL}
            />
          </group>
          <group position={[-SHOULDER_X, TORSO * 0.88, 0]}>
            <Limb
              upperLen={UPPER_ARM} lowerLen={FOREARM} upperRadius={0.05} lowerRadius={0.04}
              upperColor={kit.shirt} lowerColor={kit.skin} endColor={glove} endSize={gloveSize}
              upperRef={shoulderR} lowerRef={elbowR} endRef={handR}
            />
          </group>
        </group>
        {/* Legs */}
        <group position={[HIP_X, -0.04, 0]}>
          <Limb
            upperLen={THIGH} lowerLen={SHIN} upperRadius={0.075} lowerRadius={0.058}
            upperColor={kit.trousers} lowerColor={kit.trousers} endColor="#1d1d1f" endSize={[0.1, 0.07, 0.26]}
            upperRef={hipL} lowerRef={kneeL} endRef={footL} pads={kit.pads}
          />
        </group>
        <group position={[-HIP_X, -0.04, 0]}>
          <Limb
            upperLen={THIGH} lowerLen={SHIN} upperRadius={0.075} lowerRadius={0.058}
            upperColor={kit.trousers} lowerColor={kit.trousers} endColor="#1d1d1f" endSize={[0.1, 0.07, 0.26]}
            upperRef={hipR} lowerRef={kneeR} endRef={footR} pads={kit.pads}
          />
        </group>
      </group>
    </group>
  );
});

function setLeg(hip: Group | null, knee: Group | null, foot: Group | null, l: LimbPose, side: 1 | -1): void {
  if (!hip || !knee) return;
  hip.rotation.set(-l.pitch, 0, side * l.roll);
  knee.rotation.set(l.bend, 0, 0);
  // Keep the foot roughly flat.
  if (foot) foot.rotation.set(l.pitch - l.bend, 0, 0);
}

/**
 * Arm: either from Euler-style limb angles, or aimed at a world-space hand
 * target with a simple two-bone solve (elbow bend from the law of cosines).
 */
function setArm(shoulder: Group | null, elbow: Group | null, l: LimbPose, side: 1 | -1, target: Vector3 | undefined): void {
  if (!shoulder || !elbow) return;
  if (!target || !shoulder.parent) {
    shoulder.quaternion.identity();
    shoulder.rotation.set(-l.pitch, 0, side * l.roll);
    elbow.rotation.set(-l.bend, 0, 0);
    return;
  }
  // Shoulder position and target in the shoulder's parent space.
  const parent = shoulder.parent;
  parent.updateWorldMatrix(true, false);
  tmpM.copy(parent.matrixWorld).invert();
  const local = tmpV.copy(target).applyMatrix4(tmpM).sub(shoulder.position);
  const dist = Math.min(local.length(), UPPER_ARM + FOREARM - 1e-3);
  const dir = local.normalize();
  // Elbow bend so that upper + forearm reach `dist`.
  const cosElbow = (UPPER_ARM ** 2 + FOREARM ** 2 - dist ** 2) / (2 * UPPER_ARM * FOREARM);
  const elbowAngle = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosElbow)));
  const cosShoulder = (UPPER_ARM ** 2 + dist ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * dist);
  const offset = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
  // Point the upper arm at the target, then lift it by `offset` so the elbow bends down-and-out.
  tmpQ.setFromUnitVectors(DOWN, dir);
  shoulder.quaternion.copy(tmpQ);
  const axis = tmpV2.set(1, 0, 0);
  shoulder.rotateOnAxis(axis, -offset * 0.5);
  elbow.rotation.set(-elbowAngle * 0.9, 0, 0);
}
