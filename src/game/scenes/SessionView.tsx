import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type Group, type Mesh, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useGame } from '../../state/game.ts';
import { keyboard } from '../input/useGameControls.ts';
import { exposeDebug } from '../debug.ts';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_POPPING_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { directionVector } from '../batting/contact.ts';
import { SHOTS } from '../batting/shots.ts';
import { offSideSign } from '../model/player.ts';
import type { PracticeSession } from '../session/practice.ts';
import { predictArrival } from '../simulation/ballInPlay.ts';
import { PlayerFigure } from './PlayerFigure.tsx';

/**
 * Everything that moves. The session (simulation) is advanced once per frame
 * by <Driver>; every other component reads it in its own frame callback and
 * positions meshes imperatively — no React state changes per frame.
 */

/** Shared between views within a frame: where the bowler's hand is (the ball sits there in the run-up). */
const bowlerHand = new Vector3(0.3, 2.1, BOWLER_STUMPS_Z - 3);

const DOWN = new Vector3(0, -1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();

/** Moves `current` towards `target` at no more than `speed` m/s (no teleporting). */
function approach(current: Vector3, tx: number, tz: number, speed: number, dt: number): void {
  const dx = tx - current.x;
  const dz = tz - current.z;
  const d = Math.hypot(dx, dz);
  const step = speed * dt;
  if (d <= step || d < 1e-6) {
    current.x = tx;
    current.z = tz;
  } else {
    current.x += (dx / d) * step;
    current.z += (dz / d) * step;
  }
}

export function SessionView() {
  const session = useGame((s) => s.session);
  // Keyed by session so every view resets its internal state on restart.
  return <SessionScene key={session.config.seed} session={session} />;
}

function SessionScene({ session }: { session: PracticeSession }) {
  const batting = session.config.battingTeam.colors;
  const fielding = session.config.bowlingTeam.colors;
  return (
    <group>
      <Driver session={session} />
      <BowlerView session={session} kit={fielding.primary} cap={fielding.secondary} />
      <FieldersView session={session} kit={fielding.primary} cap={fielding.secondary} />
      <StrikerView session={session} kit={batting.primary} cap={batting.secondary} />
      <NonStrikerView session={session} kit={batting.primary} cap={batting.secondary} />
      <BallView session={session} />
      <Markers session={session} />
      <CameraRig session={session} />
    </group>
  );
}

// --- Driver ----------------------------------------------------------------------

function Driver({ session }: { session: PracticeSession }) {
  const steps = useRef(0);
  useEffect(
    () =>
      exposeDebug({
        ballPosition: () => {
          const b = session.cycle?.play?.ball.position;
          return b ? { ...b } : { x: 0, y: 0, z: 0 };
        },
        simSteps: () => steps.current,
        phase: () => session.phase,
        ballPhase: () => session.cycle?.phase ?? null,
        eta: () => {
          const c = session.cycle;
          if (!c?.delivery || !c.play || c.phase !== 'inFlight') return undefined;
          const a = predictArrival(c.delivery, STRIKER_POPPING_Z - 0.55, c.ground);
          return a ? a.t - c.play.time : undefined;
        },
        balls: () => session.history.length,
        score: () => ({ runs: session.score.runs, wickets: session.score.wickets, balls: session.score.balls }),
        lastHeadline: () => session.lastOutcome?.headline,
      }),
    [session],
  );
  useFrame((_, delta) => {
    // Human bowler aiming: held arrows move the target (screen-relative).
    if (session.phase === 'aiming' && session.config.bowling === 'human') {
      const dir = keyboard.direction();
      const off = offSideSign(session.striker.battingHand);
      // Screen-left is world +x; convert to the batter-relative line.
      if (dir.x !== 0 || dir.y !== 0) session.adjustTarget(-dir.x * off * 0.6 * delta, -dir.y * 4 * delta);
    }
    steps.current += session.advance(delta);
    const c = session.cycle;
    if (c?.phase === 'runUp' && session.config.bowling === 'human') useGame.getState().setMeter(session.meter);
  });
  return null;
}

// --- Bowler ----------------------------------------------------------------------

function BowlerView({ session, kit, cap }: { session: PracticeSession; kit: string; cap: string }) {
  const ref = useRef<Group>(null);
  const arm = useRef<Mesh>(null);
  const pos = useMemo(() => new Vector3(0.6, 0, BOWLER_STUMPS_Z - 12), []);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const c = session.cycle;
    const bowler = session.bowler;
    const right = bowler.bowlingArm === 'right';
    const runLength = c ? (c.releaseTime > 1.5 ? 14 : 6) : 12;
    const crease = { x: right ? 0.45 : -0.45, z: BOWLER_STUMPS_Z + 0.9 };
    const mark = { x: right ? 1.1 : -1.1, z: BOWLER_STUMPS_Z - runLength };
    let armAngle = 0;
    if (!c || session.phase !== 'delivery') {
      // Walking back to the mark between balls.
      approach(pos, mark.x, mark.z, 6, dt);
    } else if (c.phase === 'runUp') {
      const t = Math.min(1, c.time / c.releaseTime);
      // Accelerating approach: covers more ground late in the run.
      const s = t * t * (3 - 2 * t) * 0.6 + t * 0.4;
      pos.x = mark.x + (crease.x - mark.x) * s;
      pos.z = mark.z + (crease.z - mark.z) * s;
      // Bowling arm comes over in the last 0.35 s.
      const windup = Math.max(0, (c.time - (c.releaseTime - 0.35)) / 0.35);
      armAngle = windup * Math.PI * 1.15;
    } else {
      // Follow-through, then as a fielder wherever the fielding plan takes him.
      const idx = c.opts.field.findIndex((f) => f.position.id === 'bowler');
      const target = c.fielderPos[idx];
      if (target) approach(pos, target.x, target.z, 7, dt);
      armAngle = Math.PI * 1.15 + Math.min(1, c.flightTime / 0.4) * 0.8;
    }
    g.position.set(pos.x, 0, pos.z);
    if (arm.current) arm.current.rotation.x = -armAngle;
    // The ball is held at the top of the arc until release.
    const side = right ? -0.24 : 0.24;
    const reach = 0.72;
    bowlerHand.set(pos.x + side, 1.45 + Math.cos(Math.PI - armAngle) * -reach, pos.z + Math.sin(armAngle) * reach * 0.6);
  });
  const right = session.bowler.bowlingArm === 'right';
  return (
    <group>
      <PlayerFigure ref={ref} kit={kit} cap={cap} />
      <group position={[0, 0, 0]}>
        <BowlerArm armRef={arm} bowlerRef={ref} side={right ? -0.24 : 0.24} kit={kit} />
      </group>
    </group>
  );
}

function BowlerArm({ armRef, bowlerRef, side, kit }: { armRef: React.RefObject<Mesh | null>; bowlerRef: React.RefObject<Group | null>; side: number; kit: string }) {
  const shoulder = useRef<Group>(null);
  useFrame(() => {
    const b = bowlerRef.current;
    const s = shoulder.current;
    if (b && s) s.position.set(b.position.x + side, 1.45, b.position.z);
  });
  return (
    <group ref={shoulder}>
      <mesh ref={armRef} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.72, 8]} />
        <meshStandardMaterial color={kit} roughness={0.8} />
      </mesh>
    </group>
  );
}

// --- Fielders --------------------------------------------------------------------

function FieldersView({ session, kit, cap }: { session: PracticeSession; kit: string; cap: string }) {
  const initial = useMemo(() => session.field, [session]);
  const refs = useRef<(Group | null)[]>([]);
  const shown = useMemo(() => initial.map((f) => new Vector3(f.start.x, 0, f.start.z)), [initial]);
  useFrame((_, dt) => {
    const c = session.cycle;
    const field = c?.opts.field ?? session.field;
    field.forEach((f, i) => {
      if (f.position.id === 'bowler') return;
      const v = shown[i];
      const g = refs.current[i];
      if (!v || !g) return;
      const live = c && (c.phase === 'struck' || c.phase === 'dead') ? c.fielderPos[i] : undefined;
      const target = live ?? f.start;
      approach(v, target.x, target.z, live ? 9 : 4.5, dt);
      const crouch = f.keeper && (!c || c.phase !== 'struck') ? 0.55 : 1;
      g.position.set(v.x, 0, v.z);
      g.scale.set(1, crouch, 1);
    });
  });
  return (
    <group>
      {initial.map((f, i) =>
        f.position.id === 'bowler' ? null : (
          <PlayerFigure
            key={f.position.id}
            kit={f.keeper ? '#e9e5da' : kit}
            cap={cap}
            ref={(g) => {
              refs.current[i] = g;
            }}
          />
        ),
      )}
    </group>
  );
}

// --- Batters ---------------------------------------------------------------------

const BAT_LENGTH = 0.86;
const SWEET_SPOT = 0.7;

function StrikerView({ session, kit, cap }: { session: PracticeSession; kit: string; cap: string }) {
  const body = useRef<Group>(null);
  const bat = useRef<Group>(null);
  const bodyPos = useMemo(() => new Vector3(), []);
  const hands = useMemo(() => new Vector3(), []);
  const batDir = useMemo(() => new Vector3(0, -1, 0), []);
  useFrame((_, dt) => {
    const b = body.current;
    const bt = bat.current;
    if (!b || !bt) return;
    const off = offSideSign(session.striker.battingHand);
    const c = session.cycle;
    const play = c?.play;
    const stroke = play?.strokeInfo;

    // Stance: body on the leg side of middle stump, bat grounded behind the toe.
    const stanceBody = tmpA.set(-off * 0.42, 0, STRIKER_POPPING_Z + 0.2);
    const stanceHands = tmpB.set(-off * 0.16, 0.9, STRIKER_POPPING_Z + 0.08);
    const stanceDir = new Vector3(off * 0.15, -1, 0.12).normalize();

    if (!stroke || !play) {
      approach(bodyPos, stanceBody.x, stanceBody.z, 2.5, dt);
      hands.copy(stanceHands);
      batDir.lerp(stanceDir, Math.min(1, dt * 8)).normalize();
    } else {
      const def = SHOTS[stroke.attempt.shot];
      const t = play.time;
      const p = Math.min(1, Math.max(0, (t - stroke.pressTime) / Math.max(0.05, stroke.batTime - stroke.pressTime)));
      const follow = Math.max(0, (t - stroke.batTime) / 0.35);
      // Where the bat meets the ball: the line the batter set, at the contact plane.
      const contact = new Vector3(stroke.expected.x, Math.min(1.9, Math.max(0.06, stroke.expected.y)), stroke.planeZ);
      const leave = def.kind === 'leave';
      const crouch = def.kind === 'sweep' ? 0.35 : 0;
      const target = leave
        ? new Vector3(-off * 0.45, 0, stroke.planeZ + 0.4)
        : new Vector3(contact.x - off * 0.38, 0, contact.z + (stroke.attempt.footwork === 'front' ? 0.42 : 0.3));
      bodyPos.lerpVectors(stanceBody, target, Math.min(1, p * 1.3));
      bodyPos.y = -crouch * Math.min(1, p * 2);
      const shoulder = new Vector3(bodyPos.x + off * 0.1, 1.35 + bodyPos.y, bodyPos.z - 0.05);
      const toBall = contact.clone().sub(shoulder);
      const dist = toBall.length();
      const contactDir = toBall.normalize();
      // Hands placed so the sweet spot reaches the contact point exactly at contact time.
      const contactHands = dist > SWEET_SPOT ? contact.clone().addScaledVector(contactDir, -SWEET_SPOT) : shoulder.clone();
      const backlift = new Vector3(-off * 0.35, 0.85, 0.45).normalize();
      const aim = directionVector(stroke.attempt.aimDeg ?? def.direction, 0, off);
      const followDir = new Vector3(aim.x * 0.5, 0.95, aim.z * 0.5).normalize();
      if (leave) {
        hands.lerpVectors(stanceHands, shoulder.clone().add(new Vector3(0, 0.35, 0.1)), Math.min(1, p * 2));
        batDir.copy(backlift);
      } else if (p < 0.4) {
        hands.lerpVectors(stanceHands, shoulder.clone().add(new Vector3(-off * 0.2, 0.25, 0.15)), p / 0.4);
        slerpDir(batDir, stanceDir, backlift, p / 0.4);
      } else if (p < 1) {
        const k = (p - 0.4) / 0.6;
        hands.lerpVectors(shoulder.clone().add(new Vector3(-off * 0.2, 0.25, 0.15)), contactHands, k * k);
        slerpDir(batDir, backlift, contactDir, k * k);
      } else {
        const k = Math.min(1, follow);
        hands.lerpVectors(contactHands, shoulder.clone().add(new Vector3(aim.x * 0.3, 0.3, aim.z * 0.3)), k);
        slerpDir(batDir, contactDir, followDir, k);
      }
    }
    b.position.copy(bodyPos);
    bt.position.copy(hands);
    tmpQ.setFromUnitVectors(DOWN, batDir);
    bt.quaternion.copy(tmpQ);
  });
  return (
    <group>
      <PlayerFigure ref={body} kit={kit} cap={cap} />
      <group ref={bat}>
        {/* Handle */}
        <mesh position={[0, -0.14, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.28, 8]} />
          <meshStandardMaterial color="#2b2b2b" roughness={0.9} />
        </mesh>
        {/* Blade */}
        <mesh position={[0, -0.28 - (BAT_LENGTH - 0.28) / 2, 0]} castShadow>
          <boxGeometry args={[FIELD.batWidth, BAT_LENGTH - 0.28, 0.045]} />
          <meshStandardMaterial color="#e6cf98" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

function slerpDir(out: Vector3, from: Vector3, to: Vector3, t: number): void {
  const qa = new Quaternion().setFromUnitVectors(DOWN, from);
  const qb = new Quaternion().setFromUnitVectors(DOWN, to);
  qa.slerp(qb, Math.min(1, Math.max(0, t)));
  out.copy(DOWN).applyQuaternion(qa).normalize();
}

function NonStrikerView({ session, kit, cap }: { session: PracticeSession; kit: string; cap: string }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const off = offSideSign(session.striker.battingHand);
    // Backs up on the other side of the stumps from the bowler's arm.
    const side = session.bowler.bowlingArm === 'right' ? -1 : 1;
    const backingUp = session.cycle?.phase === 'runUp' ? Math.min(1, session.cycle.time / session.cycle.releaseTime) : 0;
    g.position.set(side * 1.4 + off * 0, 0, BOWLER_STUMPS_Z + 1.0 + backingUp * 0.8);
  });
  return <PlayerFigure ref={ref} kit={kit} cap={cap} />;
}

// --- Ball --------------------------------------------------------------------------

function BallView({ session }: { session: PracticeSession }) {
  const ref = useRef<Mesh>(null);
  const out = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const c = session.cycle;
    if (!c || c.phase === 'runUp') {
      m.position.copy(bowlerHand);
      m.visible = c !== undefined || session.phase === 'aiming';
      return;
    }
    m.visible = true;
    const play = c.play;
    if (play && c.carrier === undefined && c.phase !== 'dead') {
      // Interpolate between the last two fixed steps.
      const a = session.clock.alpha;
      const p0 = play.previous;
      const p1 = play.ball.position;
      m.position.set(p0.x + (p1.x - p0.x) * a, p0.y + (p1.y - p0.y) * a, p0.z + (p1.z - p0.z) * a);
      return;
    }
    c.ballPosition(out);
    m.position.set(out.x, out.y, out.z);
  });
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[FIELD.ballRadius, 20, 14]} />
      <meshStandardMaterial color="#b3191e" roughness={0.35} metalness={0.05} />
    </mesh>
  );
}

// --- Markers ----------------------------------------------------------------------

function Markers({ session }: { session: PracticeSession }) {
  const pitchMark = useRef<Mesh>(null);
  const target = useRef<Mesh>(null);
  useFrame(() => {
    const c = session.cycle;
    const pm = pitchMark.current;
    if (pm) {
      const bounce = c?.events.find((e) => e.type === 'bounce' && !e.struck);
      if (bounce && bounce.type === 'bounce') {
        pm.visible = true;
        pm.position.set(bounce.x, 0.012, bounce.z);
      } else pm.visible = false;
    }
    const tm = target.current;
    if (tm) {
      const human = session.config.bowling === 'human';
      const show = human && (session.phase === 'aiming' || (c?.phase === 'runUp' && session.phase === 'delivery'));
      tm.visible = show;
      if (show) {
        const off = offSideSign(session.striker.battingHand);
        tm.position.set(session.setup.line * off, 0.014, STRIKER_STUMPS_Z - session.setup.length);
      }
    }
  });
  return (
    <group>
      <mesh ref={pitchMark} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[0.07, 20]} />
        <meshBasicMaterial color="#5a3b1c" transparent opacity={0.7} />
      </mesh>
      <mesh ref={target} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.11, 0.16, 32]} />
        <meshBasicMaterial color="#ffd23f" />
      </mesh>
    </group>
  );
}

// --- Camera ------------------------------------------------------------------------

// Raised and long, like a broadcast camera: the striker is large in frame and the
// bowler's run-up passes beneath the view rather than blocking it.
const BROADCAST = { pos: new Vector3(0, 6.2, BOWLER_STUMPS_Z - 16), target: new Vector3(0, 1.0, STRIKER_STUMPS_Z - 1.6), fov: 17 };
const BATTER_END = { pos: new Vector3(0, 2.1, STRIKER_STUMPS_Z + 7), target: new Vector3(0, 1.0, BOWLER_STUMPS_Z), fov: 40 };
const HIGH = { pos: new Vector3(0, 48, BOWLER_STUMPS_Z - 40), target: new Vector3(0, 0, 8), fov: 45 };

function CameraRig({ session }: { session: PracticeSession }) {
  const camera = useThree((s) => s.camera);
  const mode = useGame((s) => s.camera);
  const look = useMemo(() => BROADCAST.target.clone(), []);
  const pos = useMemo(() => BROADCAST.pos.clone(), []);
  useFrame((_, dt) => {
    const preset = mode === 'batter' ? BATTER_END : mode === 'high' ? HIGH : BROADCAST;
    const c = session.cycle;
    const ball = c?.play?.ball.position;
    let fov = preset.fov;
    const wantPos = tmpA.copy(preset.pos);
    const wantLook = tmpB.copy(preset.target);
    if (mode === 'broadcast' && c && (c.phase === 'struck' || c.phase === 'dead') && ball && c.contact !== undefined) {
      // Follow the struck ball: rise and widen to keep it and the chasing fielder in view.
      const d = Math.hypot(ball.x, ball.z - STRIKER_STUMPS_Z);
      wantLook.set(ball.x * 0.85, Math.max(0.5, ball.y * 0.8), ball.z * 0.85 + STRIKER_STUMPS_Z * 0.15);
      wantPos.set(ball.x * 0.2, 6.2 + Math.min(26, d * 0.45 + ball.y * 0.6), BOWLER_STUMPS_Z - 16 - Math.min(8, d * 0.12));
      fov = Math.min(55, 24 + d * 0.4);
    }
    const k = 1 - Math.exp(-dt * (c?.phase === 'struck' ? 4 : 2.5));
    pos.lerp(wantPos, k);
    look.lerp(wantLook, k);
    camera.position.copy(pos);
    camera.lookAt(look);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
