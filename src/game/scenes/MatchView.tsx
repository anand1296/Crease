import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type Group, type Mesh, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { useGame } from '../../state/game.ts';
import { sound } from '../audio/sound.ts';
import { keyboard } from '../input/keyboardInstance.ts';
import { exposeDebug } from '../debug.ts';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_POPPING_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import type { Team } from '../data/teams.ts';
import { directionVector } from '../batting/contact.ts';
import { SHOTS } from '../batting/shots.ts';
import type { Match } from '../match/match.ts';
import { type Player, offSideSign } from '../model/player.ts';
import { isOnPitch } from '../physics/ball.ts';
import { predictArrival } from '../simulation/ballInPlay.ts';
import { Humanoid, type HumanoidHandle, type Kit, type Pose, neutralPose } from './rig/Humanoid.tsx';
import { battingStance, bowlingAction, celebrate, gait, gather, keeperStance, readyStance, resetPose, throwing } from './rig/motion.ts';

/**
 * Everything that moves. The match (simulation) is advanced once per frame
 * by <Driver>; every other component reads it in its own frame callback and
 * positions meshes imperatively. Nothing here changes the simulation.
 */

const SKIN = ['#8d5a3b', '#c58c64', '#e3b48f', '#6b4128', '#b07a55', '#f1c9a5', '#5a3622', '#d9a07a'];
const skinFor = (id: string) => SKIN[Math.abs(hash(id)) % SKIN.length] ?? '#c58c64';
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const darken = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};

function kitFor(team: Team, player: Player, role: 'batter' | 'keeper' | 'fielder'): Kit {
  return {
    shirt: team.colors.primary,
    trim: team.colors.secondary,
    trousers: darken(team.colors.primary, 0.55),
    skin: skinFor(player.id),
    headwear: role === 'batter' ? 'helmet' : role === 'keeper' ? 'cap' : hash(player.id) % 4 === 0 ? 'hat' : 'cap',
    pads: role !== 'fielder',
    gloves: role === 'batter' ? 'batting' : role === 'keeper' ? 'keeping' : 'none',
  };
}

const DOWN = new Vector3(0, -1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();

export function MatchView() {
  const match = useGame((s) => s.match);
  if (!match) return <MenuCamera />;
  // Keyed by match so every view resets its internal state on a new match.
  return <MatchScene key={match.config.seed} match={match} />;
}

function MatchScene({ match }: { match: Match }) {
  const inningsIndex = useGame((s) => s.snap?.inningsIndex ?? 0);
  return (
    <group>
      <Driver match={match} />
      {/* Re-mount the players when the sides swap at the innings break. */}
      <Players key={inningsIndex} match={match} />
      <BallView match={match} />
      <Markers match={match} />
      <CameraRig match={match} />
    </group>
  );
}

// --- Driver ---------------------------------------------------------------------------

function Driver({ match }: { match: Match }) {
  const steps = useRef(0);
  const heard = useRef<{ cycle: unknown; n: number; outcome: unknown }>({ cycle: undefined, n: 0, outcome: undefined });
  useEffect(
    () =>
      exposeDebug({
        ballPosition: () => {
          const b = match.cycle?.play?.ball.position;
          return b ? { ...b } : { x: 0, y: 0, z: 0 };
        },
        simSteps: () => steps.current,
        phase: () => match.phase,
        ballPhase: () => match.cycle?.phase ?? null,
        eta: () => {
          const c = match.cycle;
          if (!c?.delivery || !c.play || c.phase !== 'inFlight') return undefined;
          const a = predictArrival(c.delivery, STRIKER_POPPING_Z - 0.55, c.ground);
          return a ? a.t - c.play.time : undefined;
        },
        balls: () => match.history.length,
        score: () => ({ runs: match.current.runs, wickets: match.current.wickets, balls: match.current.balls }),
        lastHeadline: () => match.lastOutcome?.headline,
      }),
    [match],
  );
  useFrame((_, delta) => {
    // Human bowler aiming: held arrows move the target (screen-relative).
    if (match.phase === 'aiming' && match.humanBowling) {
      const dir = keyboard.direction();
      const off = offSideSign(match.striker.battingHand);
      if (dir.x !== 0 || dir.y !== 0) match.adjustTarget(-dir.x * off * 0.6 * delta, -dir.y * 4 * delta);
    }
    steps.current += match.advance(delta);
    const c = match.cycle;
    if (c?.phase === 'runUp' && match.humanBowling) useGame.getState().setMeter(match.meter);
    // Sound for whatever happened this frame.
    const h = heard.current;
    if (h.cycle !== c) {
      h.cycle = c;
      h.n = 0;
    }
    if (c) {
      for (; h.n < c.events.length; h.n++) {
        const ev = c.events[h.n];
        if (!ev) continue;
        if (ev.type === 'bounce') sound.bounce(isOnPitch({ x: ev.x, y: 0, z: ev.z }), ev.struck ? 4 : 8);
        else if (ev.type === 'contact') sound.bat(ev.result.quality, ev.result.exitSpeed, ev.result.kind === 'edge');
        else if (ev.type === 'pad' || ev.type === 'body') sound.pad();
        else if (ev.type === 'stumps') sound.stumps();
        else if (ev.type === 'boundary') sound.boundary(ev.six);
      }
    }
    const o = match.lastOutcome;
    if (o && o !== h.outcome) {
      h.outcome = o;
      if (o.wicket?.kind === 'caught') sound.catchTaken();
      else if (o.wicket?.kind === 'lbw') sound.cheer(0.9, 3);
      else if (o.wicket?.kind === 'runOut') sound.stumps();
    }
  });
  return null;
}

// --- Players ---------------------------------------------------------------------------

interface Motion {
  pos: Vector3;
  facing: number;
  phase: number;
  pose: Pose;
}

const newMotion = (x: number, z: number): Motion => ({ pos: new Vector3(x, 0, z), facing: 0, phase: 0, pose: neutralPose() });

/** Moves towards (tx, tz) at no more than `speed` m/s. Returns the distance moved. */
function approach(m: Motion, tx: number, tz: number, speed: number, dt: number): number {
  const dx = tx - m.pos.x;
  const dz = tz - m.pos.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, speed * dt);
  if (d > 1e-6) {
    m.pos.x += (dx / d) * step;
    m.pos.z += (dz / d) * step;
    if (step > 0.002) m.facing = turnTowards(m.facing, Math.atan2(dx, dz), dt * 8);
  }
  return step;
}

function turnTowards(current: number, target: number, rate: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-rate, Math.min(rate, d));
}

/** Gait that matches how far the player actually moved this frame. */
function stride(m: Motion, moved: number, dt: number, sprint: number): void {
  const speed = dt > 0 ? moved / dt : 0;
  m.phase += moved * 2.4;
  gait(m.pose, m.phase, Math.min(1, speed / sprint));
}

const BAT_LENGTH = 0.86;
const SWEET_SPOT = 0.7;
const RUN_LANE = 1.25;
const END_Z = STRIKER_POPPING_Z + 0.35;

function Players({ match }: { match: Match }) {
  const fielding = match.bowlingSide;
  const batting = match.battingSide;
  const handles = useRef(new Map<string, HumanoidHandle | null>());
  const motions = useMemo(() => new Map<string, Motion>(), []);
  const strikerBat = useRef<Group>(null);
  const runnerBat = useRef<Group>(null);
  const batState = useMemo(() => ({ body: new Vector3(), hands: new Vector3(), dir: new Vector3(0, -1, 0) }), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw);
    const c = match.cycle;
    const t = match.time;
    const field = c?.opts.field ?? match.field;
    const wicket = c?.phase === 'dead' && c.outcome?.wicket !== undefined;
    const keeper = match.keeperOf(match.current.bowling);

    // ---- Fielding side ----
    field.forEach((f, i) => {
      const h = handles.current.get(f.player.id);
      if (!h) return;
      let m = motions.get(f.player.id);
      if (!m) {
        m = newMotion(f.start.x, f.start.z);
        motions.set(f.player.id, m);
      }
      const p = m.pose;
      const isBowler = f.position.id === 'bowler';
      const facingBatter = Math.atan2(0 - m.pos.x, STRIKER_STUMPS_Z - m.pos.z);
      if (isBowler) {
        poseBowler(match, m, dt, t);
      } else if (f.player.id === keeper.id) {
        const live = c && (c.phase === 'struck' || c.phase === 'dead') ? c.fielderPos[i] : undefined;
        const moved = approach(m, live?.x ?? f.start.x, live?.z ?? f.start.z, live ? 8 : 3, dt);
        if (moved > 0.01) stride(m, moved, dt, 8);
        else {
          const rise = c?.phase === 'inFlight' ? Math.min(1, c.flightTime / 0.5) : c && c.phase !== 'runUp' ? 1 : 0;
          keeperStance(p, rise);
          m.facing = turnTowards(m.facing, Math.PI, dt * 6);
        }
        if (c?.carrier === i) gather(p);
      } else {
        const live = c && (c.phase === 'struck' || c.phase === 'dead') ? c.fielderPos[i] : undefined;
        const moved = approach(m, live?.x ?? f.start.x, live?.z ?? f.start.z, live ? 9 : 3.5, dt);
        if (moved > 0.004) stride(m, moved, dt, 8);
        else {
          readyStance(p, t + i);
          m.facing = turnTowards(m.facing, facingBatter, dt * 4);
        }
        if (c?.carrier === i) {
          const throwStart = (c.collectedAt ?? Infinity) + 0.55;
          if (c.returnAt !== undefined && c.runStarts.length > 0 && t >= (c.collectedAt ?? Infinity)) {
            const u = (c.time - (c.collectedAt ?? c.time)) / Math.max(0.3, throwStart + 0.35 - (c.collectedAt ?? 0));
            throwing(p, u, f.player.bowlingArm === 'right');
          } else gather(p);
        }
      }
      if (wicket && !isBowler) celebrate(p, t + i * 0.3);
      if (wicket && isBowler && c?.phase === 'dead') celebrate(p, t);
      p.x = m.pos.x;
      p.z = m.pos.z;
      p.facing = m.facing;
      h.apply(p);
    });

    // ---- Batters ----
    const off = offSideSign(match.striker.battingHand);
    const strikerId = match.striker.id;
    const nonStrikerId = match.nonStriker.id;
    const runs = c ? c.runProgress(c.time) : { completed: 0, current: undefined };
    const running = c !== undefined && c.runStarts.length > 0 && (c.phase === 'struck' || c.phase === 'dead');
    // Original striker's z along the run: even completed runs → striker's end.
    const runnerZ = (startAtStrikerEnd: boolean) => {
      let atStriker = startAtStrikerEnd;
      if (runs.completed % 2 === 1) atStriker = !atStriker;
      const from = atStriker ? END_Z : -END_Z;
      const to = -from;
      return runs.current === undefined ? from : from + (to - from) * easeRun(runs.current);
    };

    for (const id of [strikerId, nonStrikerId]) {
      const h = handles.current.get(id);
      if (!h) continue;
      let m = motions.get(id);
      if (!m) {
        m = newMotion(id === strikerId ? -off * 0.42 : -1.3, id === strikerId ? STRIKER_POPPING_Z + 0.2 : BOWLER_STUMPS_Z + 1);
        motions.set(id, m);
      }
      const p = m.pose;
      if (running) {
        const z = runnerZ(id === strikerId);
        const lane = id === strikerId ? RUN_LANE : -RUN_LANE;
        const moved = approach(m, lane * off, z, 10, dt);
        stride(m, moved, dt, 7.5);
      } else if (id === strikerId) {
        poseStriker(match, m, batState, dt);
      } else {
        // Non-striker backs up as the bowler runs in.
        const side = match.bowler.bowlingArm === 'right' ? -1 : 1;
        const backing = c?.phase === 'runUp' ? Math.min(1, c.time / c.releaseTime) : c ? 1 : 0;
        const moved = approach(m, side * 1.3, BOWLER_STUMPS_Z + 1.0 + backing * 1.2, 3, dt);
        if (moved > 0.004) stride(m, moved, dt, 7.5);
        else {
          resetPose(p);
          p.drop = 0.04;
          m.facing = turnTowards(m.facing, 0, dt * 4);
        }
      }
      p.x = m.pos.x;
      p.z = m.pos.z;
      p.facing = m.facing;
      h.apply(p);
    }

    // Striker's bat: in the stroke it is posed by poseStriker; while running, carried.
    const sb = strikerBat.current;
    if (sb) {
      if (running) {
        const sh = handles.current.get(strikerId);
        if (sh) carryBat(sb, sh, m0(motions.get(strikerId)));
      } else {
        sb.position.copy(batState.hands);
        tmpQ.setFromUnitVectors(DOWN, batState.dir);
        sb.quaternion.copy(tmpQ);
      }
    }
    const rb = runnerBat.current;
    const nh = handles.current.get(nonStrikerId);
    if (rb && nh) carryBat(rb, nh, m0(motions.get(nonStrikerId)));
  });

  const keeperId = match.keeperOf(match.current.bowling).id;
  return (
    <group>
      {fielding.xi.map((p) => (
        <Humanoid
          key={p.id}
          kit={kitFor(fielding.team, p, p.id === keeperId ? 'keeper' : 'fielder')}
          ref={(h) => {
            handles.current.set(p.id, h);
          }}
        />
      ))}
      {batting.xi.map((p) => (
        <BatterSlot key={p.id} player={p} team={batting.team} handles={handles} />
      ))}
      <Bat refObj={strikerBat} />
      <Bat refObj={runnerBat} />
    </group>
  );
}

const m0 = (m: Motion | undefined) => m?.facing ?? 0;
const easeRun = (u: number) => u * u * (3 - 2 * u) * 0.35 + u * 0.65;

/** Only the two batters at the crease are drawn. */
function BatterSlot({ player, team, handles }: { player: Player; team: Team; handles: React.RefObject<Map<string, HumanoidHandle | null>> }) {
  const atCrease = useGame((s) => (s.snap ? s.snap.striker.id === player.id || s.snap.nonStriker.id === player.id : false));
  if (!atCrease) return null;
  return (
    <Humanoid
      kit={kitFor(team, player, 'batter')}
      ref={(h) => {
        handles.current.set(player.id, h);
      }}
    />
  );
}

function Bat({ refObj }: { refObj: React.RefObject<Group | null> }) {
  return (
    <group ref={refObj}>
      <mesh position={[0, -0.14, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.28, 8]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.28 - (BAT_LENGTH - 0.28) / 2, 0]} castShadow>
        <boxGeometry args={[FIELD.batWidth, BAT_LENGTH - 0.28, 0.045]} />
        <meshStandardMaterial color="#e6cf98" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.28 - (BAT_LENGTH - 0.28) / 2, -0.03]}>
        <boxGeometry args={[FIELD.batWidth * 0.5, BAT_LENGTH - 0.32, 0.03]} />
        <meshStandardMaterial color="#d4b979" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A bat carried in the right hand while running. */
function carryBat(bat: Group, h: HumanoidHandle, facing: number): void {
  h.handWorld('R', tmpA);
  bat.position.copy(tmpA);
  tmpB.set(Math.sin(facing) * 0.6, -0.8, Math.cos(facing) * 0.6).normalize();
  tmpQ.setFromUnitVectors(DOWN, tmpB);
  bat.quaternion.copy(tmpQ);
}

function poseBowler(match: Match, m: Motion, dt: number, t: number): void {
  const c = match.cycle;
  const bowler = match.bowler;
  const right = bowler.bowlingArm === 'right';
  const p = m.pose;
  const runLength = c ? (c.releaseTime > 1.5 ? 14 : 6) : bowler.bowlingStyle === 'offSpin' || bowler.bowlingStyle === 'legSpin' ? 6 : 14;
  const crease = { x: right ? 0.42 : -0.42, z: BOWLER_STUMPS_Z + 0.9 };
  const mark = { x: right ? 1.0 : -1.0, z: BOWLER_STUMPS_Z - runLength };
  if (!c || match.phase !== 'delivery') {
    // Back to the mark between balls.
    const moved = approach(m, mark.x, mark.z, 2.6, dt);
    if (moved > 0.004) stride(m, moved, dt, 7);
    else {
      resetPose(p);
      m.facing = turnTowards(m.facing, 0, dt * 3);
    }
  } else if (c.phase === 'runUp') {
    const strideStart = c.releaseTime - 0.42;
    if (c.time < strideStart) {
      const u = Math.min(1, c.time / strideStart);
      const s = u * u * 0.55 + u * 0.45;
      const prev = m.pos.clone();
      m.pos.set(mark.x + (crease.x - mark.x) * s, 0, mark.z + (crease.z - 0.9 - mark.z) * s);
      m.facing = 0;
      stride(m, prev.distanceTo(m.pos), dt, 7);
    } else {
      const u = (c.time - strideStart) / 0.56;
      m.pos.x += (crease.x - m.pos.x) * Math.min(1, dt * 8);
      m.pos.z = Math.min(crease.z, m.pos.z + 3.5 * dt);
      m.facing = 0;
      bowlingAction(p, u, right);
    }
  } else {
    // Follow-through, then fielding wherever the plan sends him.
    const idx = c.opts.field.findIndex((f) => f.position.id === 'bowler');
    const target = c.fielderPos[idx];
    if (c.flightTime < 0.35) {
      bowlingAction(p, 0.75 + c.flightTime / 1.4, right);
      m.pos.z += 2.5 * dt;
    } else if (target) {
      const moved = approach(m, target.x, target.z, c.phase === 'inFlight' ? 3 : 8, dt);
      if (moved > 0.004) stride(m, moved, dt, 8);
      else readyStance(p, t);
    }
    if (c.carrier === idx) gather(p);
  }
}

/**
 * Striker: side-on stance, then the stroke. Hands and bat are placed so the
 * bat's sweet spot meets the ball at the simulated contact point and time.
 */
function poseStriker(match: Match, m: Motion, bat: { body: Vector3; hands: Vector3; dir: Vector3 }, dt: number): void {
  const off = offSideSign(match.striker.battingHand);
  const c = match.cycle;
  const play = c?.play;
  const stroke = play?.strokeInfo;
  const p = m.pose;
  battingStance(p);
  const frontLeg = off > 0 ? p.legL : p.legR;
  const backLeg = off > 0 ? p.legR : p.legL;
  const stanceBody = tmpA.set(-off * 0.45, 0, STRIKER_POPPING_Z + 0.22);
  const stanceHands = new Vector3(-off * 0.18, 0.88, STRIKER_POPPING_Z + 0.08);
  const stanceDir = new Vector3(off * 0.15, -1, 0.12).normalize();
  // Side-on: chest towards the off side.
  m.facing = off > 0 ? Math.PI / 2 : -Math.PI / 2;

  if (!stroke || !play) {
    m.pos.lerp(stanceBody, Math.min(1, dt * 4));
    bat.hands.copy(stanceHands);
    bat.dir.lerp(stanceDir, Math.min(1, dt * 8)).normalize();
    // Tap of the bat and a little bounce as the bowler runs in.
    if (c?.phase === 'runUp') p.bob = Math.sin(c.time * 6) * 0.01;
  } else {
    const def = SHOTS[stroke.attempt.shot];
    const tt = play.time;
    const k = Math.min(1, Math.max(0, (tt - stroke.pressTime) / Math.max(0.05, stroke.batTime - stroke.pressTime)));
    const follow = Math.max(0, (tt - stroke.batTime) / 0.35);
    const contact = new Vector3(stroke.expected.x, Math.min(1.9, Math.max(0.06, stroke.expected.y)), stroke.planeZ);
    const leave = def.kind === 'leave';
    const sweep = def.kind === 'sweep';
    const front = stroke.attempt.footwork === 'front';
    const target = leave
      ? new Vector3(-off * 0.5, 0, stroke.planeZ + 0.45)
      : new Vector3(contact.x - off * 0.42, 0, contact.z + (front ? 0.45 : 0.32));
    m.pos.lerpVectors(stanceBody, target, Math.min(1, k * 1.3));
    // Footwork: front foot strides towards the bowler (the batter's side-on "forward" is along −z).
    const step = Math.min(1, k * 1.6);
    if (front) {
      frontLeg.roll = 0.22 + 0.55 * step;
      frontLeg.bend = 0.35 + 0.4 * step;
      backLeg.roll = 0.15;
      backLeg.bend = 0.2;
    } else {
      backLeg.roll = 0.05;
      backLeg.bend = 0.15;
      frontLeg.roll = 0.35;
    }
    if (sweep) {
      p.drop = 0.42 * step;
      backLeg.bend = 1.9 * step;
      backLeg.pitch = -0.4 * step;
    }
    const shoulder = new Vector3(m.pos.x + off * 0.08, 1.35 - p.drop, m.pos.z - 0.05);
    const toBall = contact.clone().sub(shoulder);
    const dist = toBall.length();
    const contactDir = toBall.normalize();
    const contactHands = dist > SWEET_SPOT ? contact.clone().addScaledVector(contactDir, -SWEET_SPOT) : shoulder.clone();
    const backlift = new Vector3(-off * 0.35, 0.85, 0.45).normalize();
    const aim = directionVector(stroke.attempt.aimDeg ?? def.direction, 0, off);
    const followDir = new Vector3(aim.x * 0.5, 0.95, aim.z * 0.5).normalize();
    const top = shoulder.clone().add(new Vector3(-off * 0.2, 0.22, 0.15));
    if (leave) {
      bat.hands.lerpVectors(stanceHands, shoulder.clone().add(new Vector3(0, 0.35, 0.1)), Math.min(1, k * 2));
      bat.dir.copy(backlift);
    } else if (k < 0.4) {
      bat.hands.lerpVectors(stanceHands, top, k / 0.4);
      slerpDir(bat.dir, stanceDir, backlift, k / 0.4);
    } else if (k < 1) {
      const u = (k - 0.4) / 0.6;
      bat.hands.lerpVectors(top, contactHands, u * u);
      slerpDir(bat.dir, backlift, contactDir, u * u);
    } else {
      const u = Math.min(1, follow);
      bat.hands.lerpVectors(contactHands, shoulder.clone().add(new Vector3(aim.x * 0.3, 0.3, aim.z * 0.3)), u);
      slerpDir(bat.dir, contactDir, followDir, u);
    }
    // Upper body turns into the stroke.
    p.twist = -off * (Math.atan2(aim.x * off, -aim.z) * 0.35) * Math.min(1, k + follow);
    p.lean = 0.35 + 0.2 * step;
  }
  // Both hands on the handle, one above the other.
  p.handL = bat.hands.clone().addScaledVector(bat.dir, off > 0 ? 0.02 : 0.1);
  p.handR = bat.hands.clone().addScaledVector(bat.dir, off > 0 ? 0.1 : 0.02);
}

function slerpDir(out: Vector3, from: Vector3, to: Vector3, t: number): void {
  const qa = new Quaternion().setFromUnitVectors(DOWN, from);
  const qb = new Quaternion().setFromUnitVectors(DOWN, to);
  qa.slerp(qb, Math.min(1, Math.max(0, t)));
  out.copy(DOWN).applyQuaternion(qa).normalize();
}

// --- Ball ---------------------------------------------------------------------------------

function BallView({ match }: { match: Match }) {
  const ref = useRef<Mesh>(null);
  const out = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = match.cycle;
    if (!c || c.phase === 'runUp') {
      // In the bowler's hand: follows the bowling arm through the action.
      const right = match.bowler.bowlingArm === 'right';
      const u = c ? Math.max(0, (c.time - (c.releaseTime - 0.42)) / 0.56) : 0;
      const armAngle = -0.6 + Math.min(1, u) * 4.6;
      const t = c ? Math.min(1, c.time / c.releaseTime) : 0;
      const runLength = c && c.releaseTime > 1.5 ? 14 : 6;
      const x0 = right ? 1.0 : -1.0;
      const x1 = right ? 0.42 : -0.42;
      const z = BOWLER_STUMPS_Z - runLength + (runLength + 0.9) * Math.min(1, t * t * 0.55 + t * 0.45);
      const side = right ? -0.2 : 0.2;
      mesh.position.set(x0 + (x1 - x0) * t + side, 1.35 - Math.cos(armAngle) * 0.6, Math.min(z, BOWLER_STUMPS_Z + 0.9) + Math.sin(armAngle) * 0.35);
      mesh.visible = c !== undefined;
      return;
    }
    mesh.visible = true;
    const play = c.play;
    if (play && c.carrier === undefined && c.phase !== 'dead') {
      const a = match.clock.alpha;
      const p0 = play.previous;
      const p1 = play.ball.position;
      mesh.position.set(p0.x + (p1.x - p0.x) * a, p0.y + (p1.y - p0.y) * a, p0.z + (p1.z - p0.z) * a);
      return;
    }
    c.ballPosition(out);
    mesh.position.set(out.x, out.y, out.z);
  });
  return (
    <mesh ref={ref} castShadow>
      {/* Drawn larger than life (as most cricket games do) so it can be followed from the broadcast camera. */}
      <sphereGeometry args={[FIELD.ballRadius * 1.7, 20, 14]} />
      <meshStandardMaterial color="#b3191e" roughness={0.35} metalness={0.05} />
    </mesh>
  );
}

// --- Markers ---------------------------------------------------------------------------------

function Markers({ match }: { match: Match }) {
  const pitchMark = useRef<Mesh>(null);
  const target = useRef<Mesh>(null);
  useFrame(() => {
    const c = match.cycle;
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
      const show = match.humanBowling && (match.phase === 'aiming' || (c?.phase === 'runUp' && match.phase === 'delivery'));
      tm.visible = show;
      if (show) {
        const off = offSideSign(match.striker.battingHand);
        tm.position.set(match.setup.line * off, 0.014, STRIKER_STUMPS_Z - match.setup.length);
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

// --- Camera ----------------------------------------------------------------------------------

// A long lens from well behind the bowler, like a TV camera: the striker is large in frame
// and the players at the bowler's end do not loom in the foreground.
const BROADCAST = { pos: new Vector3(0, 9.5, BOWLER_STUMPS_Z - 40), target: new Vector3(0, 1.0, STRIKER_STUMPS_Z - 1.4), fov: 10.5 };
const BATTER_END = { pos: new Vector3(0, 2.1, STRIKER_STUMPS_Z + 7), target: new Vector3(0, 1.0, BOWLER_STUMPS_Z), fov: 40 };
const HIGH = { pos: new Vector3(0, 48, BOWLER_STUMPS_Z - 40), target: new Vector3(0, 0, 8), fov: 45 };

function CameraRig({ match }: { match: Match }) {
  const camera = useThree((s) => s.camera);
  const mode = useGame((s) => s.camera);
  const look = useMemo(() => BROADCAST.target.clone(), []);
  const pos = useMemo(() => BROADCAST.pos.clone(), []);
  useFrame((_, dt) => {
    const preset = mode === 'batter' ? BATTER_END : mode === 'high' ? HIGH : BROADCAST;
    const c = match.cycle;
    const ball = c?.play?.ball.position;
    let fov = preset.fov;
    const wantPos = tmpA.copy(preset.pos);
    const wantLook = tmpB.copy(preset.target);
    if (mode === 'broadcast' && c && (c.phase === 'struck' || c.phase === 'dead') && ball && c.contact !== undefined) {
      const d = Math.hypot(ball.x, ball.z - STRIKER_STUMPS_Z);
      wantLook.set(ball.x * 0.85, Math.max(0.5, ball.y * 0.8), ball.z * 0.85 + STRIKER_STUMPS_Z * 0.15);
      wantPos.set(ball.x * 0.25, 9.5 + Math.min(30, d * 0.5 + ball.y * 0.6), BOWLER_STUMPS_Z - 40 + Math.min(20, d * 0.3));
      fov = Math.min(50, 14 + d * 0.55);
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


/** Behind the menus: a slow pan around the ground. */
function MenuCamera() {
  const camera = useThree((s) => s.camera);
  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.05;
    camera.position.set(Math.sin(t) * 52, 16 + Math.sin(t * 2.3) * 3, Math.cos(t) * 52);
    camera.lookAt(0, 1, 0);
    if (camera instanceof PerspectiveCamera && camera.fov !== 50) {
      camera.fov = 50;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
