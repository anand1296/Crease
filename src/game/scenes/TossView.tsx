import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CanvasTexture, type Mesh, MeshStandardMaterial, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three';
import { type TossState, TOSS_HAND_HEIGHT, findTeam, useGame } from '../../state/game.ts';
import type { Team } from '../data/teams.ts';
import { COIN_RADIUS, COIN_SETTLED, COIN_THICKNESS, coinAt, flightTime } from '../match/toss.ts';
import { type HumanoidHandle, type Kit, type Pose, neutralPose } from './rig/Humanoid.tsx';
import { Cricketer } from './rig/Cricketer.tsx';
import { avatarFor, groomingFor, teamKit, toneFor } from './rig/kits.ts';
import { resetPose } from './rig/motion.ts';
import { exposeDebug } from '../debug.ts';

/**
 * The toss, in the middle before the match: the two captains either side of
 * the match referee on the pitch. The opposing captain spins the coin, the
 * camera follows it up and down and then looks down at it on the pitch, as
 * television does; the winner reacts. The store decides everything (the
 * face is fixed by the match seed); this only shows it.
 */

/** Where everyone stands: the captains face each other across the pitch, half turned to the camera. */
const SPOTS = {
  user: { x: -0.82, z: 0.15, facing: Math.PI * 0.64 },
  opponent: { x: 0.82, z: 0.15, facing: -Math.PI * 0.64 },
  referee: { x: 0, z: 0.75, facing: Math.PI },
} as const;

/** Where the coin lands, relative to where it leaves the hand. */
const DRIFT = { x: -0.42, z: -0.32 };

const REFEREE_KIT: Kit = { shirt: '#1d2a44', trim: '#c9a447', trousers: '#272c36', skin: '#b98260', headwear: 'cap', pads: false, gloves: 'none' };

function captainOf(team: Team) {
  return team.players.find((p) => p.id === team.captainId) ?? team.players[0];
}

/** One face of the coin, drawn: a bust (heads) or the value (tails), in struck gold. */
function coinFace(kind: 'heads' | 'tails' | 'edge'): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = kind === 'edge' ? 16 : size;
  const g = c.getContext('2d');
  if (!g) return new CanvasTexture(c);
  if (kind === 'edge') {
    // Milled edge.
    g.fillStyle = '#b8902f';
    g.fillRect(0, 0, size, 16);
    g.fillStyle = '#8a6a1f';
    for (let x = 0; x < size; x += 4) g.fillRect(x, 0, 2, 16);
  } else {
    const mid = size / 2;
    const grad = g.createRadialGradient(mid * 0.8, mid * 0.75, 10, mid, mid, mid);
    grad.addColorStop(0, '#f6dc8a');
    grad.addColorStop(0.7, '#d4a93f');
    grad.addColorStop(1, '#a37b26');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#8f6b22';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(mid, mid, mid - 10, 0, Math.PI * 2);
    g.stroke();
    // Beaded border.
    g.fillStyle = '#9c7524';
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      g.beginPath();
      g.arc(mid + Math.cos(a) * (mid - 24), mid + Math.sin(a) * (mid - 24), 3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8a651d';
    if (kind === 'heads') {
      // A head in profile, facing left, as on a coin: drawn in a 100-unit box centred on the face.
      const k = 1.35;
      const P = (x: number, y: number): [number, number] => [mid + (x - 50) * k, mid + (y - 52) * k];
      // The head.
      g.beginPath();
      g.moveTo(...P(58, 8)); // crown
      g.bezierCurveTo(...P(44, 8), ...P(35, 14), ...P(33, 24)); // forehead
      g.lineTo(...P(31, 34)); // brow
      g.lineTo(...P(24, 44)); // nose
      g.lineTo(...P(31, 47));
      g.lineTo(...P(29, 52)); // lips
      g.lineTo(...P(32, 55));
      g.lineTo(...P(31, 60));
      g.bezierCurveTo(...P(33, 67), ...P(38, 69), ...P(45, 68)); // chin
      g.lineTo(...P(60, 63)); // jaw to below the ear
      g.bezierCurveTo(...P(74, 56), ...P(80, 40), ...P(77, 26)); // back of the head
      g.bezierCurveTo(...P(74, 14), ...P(67, 8), ...P(58, 8));
      g.closePath();
      g.fill();
      // Neck and shoulders, cut off straight as a bust.
      g.beginPath();
      g.moveTo(...P(46, 64));
      g.lineTo(...P(45, 76));
      g.bezierCurveTo(...P(30, 80), ...P(20, 86), ...P(16, 96));
      g.lineTo(...P(88, 96));
      g.bezierCurveTo(...P(84, 86), ...P(76, 80), ...P(68, 76));
      g.lineTo(...P(66, 58));
      g.closePath();
      g.fill();
      // Hair line and ear, struck a little deeper.
      g.strokeStyle = '#6f4f12';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(...P(37, 16));
      g.bezierCurveTo(...P(50, 17), ...P(60, 24), ...P(63, 38));
      g.stroke();
      g.beginPath();
      g.ellipse(...P(58, 44), 5 * k, 7 * k, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(...P(36, 36));
      g.lineTo(...P(41, 36));
      g.stroke();
    } else {
      g.font = 'bold 120px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('1', mid, mid - 6);
      g.font = 'bold 22px Georgia, serif';
      g.fillText('CREASE', mid, mid + 66);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function TossView() {
  const toss = useGame((s) => s.toss);
  const setup = useGame((s) => s.setup);
  if (!toss) return null;
  const user = findTeam(setup.userTeamId);
  const opponent = findTeam(setup.opponentId);
  return (
    <Suspense fallback={null}>
      <TossScene toss={toss} user={user} opponent={opponent} />
    </Suspense>
  );
}

/** Tests and captures: hold the toss at this many seconds after the flick. */
let pinned: number | undefined;

const camPos = new Vector3();
const camLook = new Vector3();
const want = new Vector3();
const wantLook = new Vector3();
const hand = new Vector3();

function TossScene({ toss, user, opponent }: { toss: TossState; user: Team; opponent: Team }) {
  const camera = useThree((s) => s.camera);
  const people = useRef<(HumanoidHandle | null)[]>([null, null, null]);
  const poses = useMemo<Pose[]>(() => [neutralPose(), neutralPose(), neutralPose()], []);
  const coin = useRef<Mesh>(null);
  const from = useRef<Vector3 | undefined>(undefined);
  const fov = useRef(30);
  const shot = useRef<'middle' | 'air' | 'coin'>('middle');
  const userCaptain = captainOf(user);
  const oppCaptain = captainOf(opponent);
  const kits = useMemo(
    () => [
      userCaptain ? teamKit(user, opponent, true, userCaptain.id, 'captain') : REFEREE_KIT,
      oppCaptain ? teamKit(opponent, user, false, oppCaptain.id, 'captain') : REFEREE_KIT,
    ],
    [user, opponent, userCaptain, oppCaptain],
  );
  const materials = useMemo(() => {
    const m = (kind: 'heads' | 'tails' | 'edge') => new MeshStandardMaterial({ map: coinFace(kind), metalness: 0.35, roughness: 0.4, color: '#ffffff', emissive: '#2a1d05', emissiveIntensity: 0.6 });
    // Cylinder groups: side, top (heads), bottom (tails).
    return [m('edge'), m('heads'), m('tails')];
  }, []);
  useEffect(() => () => materials.forEach((m) => (m.map?.dispose(), m.dispose())), [materials]);
  // A new toss: the coin back in the captain's hand.
  useEffect(() => {
    from.current = undefined;
    shot.current = 'middle';
    camPos.set(1.6, 1.55, -6.8);
    camLook.set(0, 1.05, 0.3);
  }, [toss.seed]);

  useEffect(
    () =>
      exposeDebug({
        pinToss: (seconds: number | undefined) => {
          pinned = seconds;
        },
      }),
    [],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const since = toss.flickAt === undefined ? undefined : pinned ?? (performance.now() - toss.flickAt) / 1000;
    const result = toss.stage === 'result' && pinned === undefined;
    const spots = [SPOTS.user, SPOTS.opponent, SPOTS.referee];
    const flipper = people.current[1];

    // The coin: in the hand until the flick, then in the air, then on the pitch.
    let coinPos: Vector3 | undefined;
    const c = coin.current;
    if (c) {
      if (since === undefined || since < 0 || !from.current) {
        if (flipper) flipper.handWorld('R', hand);
        if (since !== undefined && since >= 0) from.current = hand.clone();
        c.position.set(hand.x, hand.y + 0.02, hand.z);
        c.rotation.set(0.3, 0, 0);
        c.visible = flipper !== null;
      }
      if (from.current && since !== undefined && since >= 0) {
        const s = coinAt(since, from.current, DRIFT, toss.face);
        c.position.set(s.x, s.y, s.z);
        c.rotation.set(s.flip, 0, 0);
        coinPos = c.position;
      }
    }
    const T = from.current ? flightTime(from.current.y) : flightTime(TOSS_HAND_HEIGHT);
    const landed = since !== undefined && since > T;

    // The people.
    poses.forEach((p, i) => {
      const spot = spots[i];
      const h = people.current[i];
      if (!spot || !h) return;
      resetPose(p);
      p.clip = { name: i === 2 ? 'breathe' : 'idle', time: t * 0.9 + i * 3 };
      p.x = spot.x;
      p.z = spot.z;
      p.facing = spot.facing;
      // Everyone watches the coin; before it goes up, the captains look at each other.
      p.look = coinPos ? coinPos.clone() : i === 2 ? undefined : new Vector3(-spot.x, 1.6, spot.z);
      if (i === 1 && (since === undefined || since < 0.35)) {
        // The opposing captain: coin on the thumb, then the flick.
        p.clip = undefined;
        const k = since === undefined ? -1 : Math.max(-1, Math.min(1, since / 0.12));
        p.armR.pitch = 0.75 + Math.max(0, k) * 0.55 - Math.max(0, -k - 0.5) * 0.1;
        p.armR.bend = 1.55 - Math.max(0, k) * 0.75;
        p.armR.roll = 0.12;
        p.armL.pitch = 0.05;
        p.armL.roll = 0.1;
        p.armL.bend = 0.2;
      }
      if (result && toss.userWins !== undefined && i < 2) {
        // The winner: a fist pumped.
        const won = (i === 0) === toss.userWins;
        if (won) {
          p.clip = undefined;
          p.armR.pitch = 2.3 + Math.sin(t * 7) * 0.12;
          p.armR.bend = 1.3;
          p.armR.roll = 0.25;
        }
      }
      h.apply(p);
      if (i === 2) h.headwear?.(false);
    });

    // The camera: the three in the middle; up with the coin; down on it on the pitch.
    let f = 30;
    let name: 'middle' | 'air' | 'coin' = 'middle';
    if (coinPos && since !== undefined && since < T + 0.15) {
      name = 'air';
      want.set(0.7, 1.4, -3.6);
      wantLook.set(coinPos.x * 0.7, Math.max(1, coinPos.y * 0.85), coinPos.z * 0.5 + 0.2);
      f = 34;
    } else if (coinPos && landed && !result) {
      name = 'coin';
      want.set(coinPos.x + 0.04, 0.62, coinPos.z - 0.32);
      wantLook.set(coinPos.x, 0, coinPos.z);
      f = since !== undefined && since > T + COIN_SETTLED ? 20 : 26;
    } else {
      // Medium shot from the bowler's end; a slow drift, as a hand-held camera.
      want.set(1.6 + Math.sin(t * 0.3) * 0.15, 1.55, -6.8);
      wantLook.set(0, 1.05, 0.3);
      f = 30;
    }
    // The camera follows the coin up (a pan); it cuts to the close-up on the pitch and back.
    const cut = name !== shot.current && (name === 'coin' || shot.current === 'coin');
    shot.current = name;
    const k = cut ? 1 : 1 - Math.exp(-dt * 5);
    camPos.lerp(want, k);
    camLook.lerp(wantLook, cut ? 1 : 1 - Math.exp(-dt * 9));
    fov.current += (f - fov.current) * (cut ? 1 : 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov.current) > 0.01) {
      camera.fov = fov.current;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <>
      {userCaptain ? (
        <Cricketer
          kit={kits[0] ?? REFEREE_KIT}
          avatar={avatarFor(userCaptain.id)}
          grooming={groomingFor(userCaptain.id)}
          tone={toneFor(userCaptain.id)}
          ref={(h) => {
            people.current[0] = h;
          }}
        />
      ) : null}
      {oppCaptain ? (
        <Cricketer
          kit={kits[1] ?? REFEREE_KIT}
          avatar={avatarFor(oppCaptain.id)}
          grooming={groomingFor(oppCaptain.id)}
          tone={toneFor(oppCaptain.id)}
          ref={(h) => {
            people.current[1] = h;
          }}
        />
      ) : null}
      <Cricketer
        kit={REFEREE_KIT}
        avatar="p4"
        tone={0.35}
        ref={(h) => {
          people.current[2] = h;
        }}
      />
      <mesh ref={coin} material={materials} castShadow>
        <cylinderGeometry args={[COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 48]} />
      </mesh>
    </>
  );
}
