import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type Camera, CanvasTexture, type Group, type Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { Rng } from '../core/rng.ts';
import { useGame } from '../../state/game.ts';
import { sound } from '../audio/sound.ts';
import { keyboard } from '../input/keyboardInstance.ts';
import { exposeDebug } from '../debug.ts';
import { BOWLER_STUMPS_Z, FIELD, STRIKER_POPPING_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { type Team, kitColors } from '../data/teams.ts';
import { directionVector } from '../batting/contact.ts';
import { SHOTS } from '../batting/shots.ts';
import type { Match } from '../match/match.ts';
import { type Player, offSideSign } from '../model/player.ts';
import { isOnPitch } from '../physics/ball.ts';
import { predictArrival } from '../simulation/ballInPlay.ts';
import { type ClipName, type HumanoidHandle, type Kit, type Pose, neutralPose } from './rig/Humanoid.tsx';
import { Cricketer } from './rig/Cricketer.tsx';
import { Stumps, type WicketHandle } from './Stumps.tsx';
import { type ReplayKind, ReplayRecorder, replayVectors, restorePose } from './replay.ts';
import { warmUp } from './warmup.ts';
import { AVATARS, type AvatarId } from './rig/avatarAssets.ts';
import { type Shot, WIDE, direct } from './camera/director.ts';
import { type ActionKind, actionSpan, battingStance, bowlingAction, gait, gather, keeperStance, readyStance, resetPose, throwing } from './rig/motion.ts';
import { type RunUp, runUpFor } from '../bowling/runUp.ts';
import { releasePoint } from '../bowling/execute.ts';

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

function kitFor(match: Match, team: Team, player: Player, role: 'batter' | 'keeper' | 'fielder'): Kit {
  const home = match.config.home.team.id === team.id;
  const opponent = home ? match.config.away.team : match.config.home.team;
  const colors = kitColors(team, opponent, home);
  return {
    shirt: colors.primary,
    trim: colors.secondary,
    trousers: colors.trousers ?? darken(colors.primary, 0.55),
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
  if (!match)
    return (
      <>
        <MenuCamera />
        <Stumps z={STRIKER_STUMPS_Z} />
        <Stumps z={BOWLER_STUMPS_Z} />
      </>
    );
  // Keyed by match so every view resets its internal state on a new match.
  return <MatchScene key={match.config.seed} match={match} />;
}

function MatchScene({ match }: { match: Match }) {
  const inningsIndex = useGame((s) => s.snap?.inningsIndex ?? 0);
  const recorder = useMemo(() => new ReplayRecorder(), []);
  const bowlerHand = useMemo<HandSpot>(() => ({ pos: new Vector3(), ok: false }), []);
  useEffect(() => {
    const g = useGame.getState();
    const skip = () => {
      recorder.stop();
      useGame.getState().setReplay(false, []);
    };
    g.setReplay(false, [], skip);
    return () => {
      recorder.stop();
      useGame.getState().setReplay(false, []);
    };
  }, [recorder]);
  // One boundary for the whole match, so the warm-up runs once everything
  // (player models included) is in the scene.
  return (
    <Suspense fallback={null}>
      <group>
        <Driver match={match} recorder={recorder} />
        {/* Re-mount the players when the sides swap at the innings break. */}
        <Players key={inningsIndex} match={match} recorder={recorder} bowlerHand={bowlerHand} />
        <BallView match={match} recorder={recorder} bowlerHand={bowlerHand} />
        <Wickets match={match} recorder={recorder} />
        <Umpires match={match} recorder={recorder} />
        <Markers match={match} />
        <CameraRig match={match} recorder={recorder} />
      </group>
      <WarmUp />
    </Suspense>
  );
}

/**
 * Compiles every shader and uploads every texture of the new match before
 * play (see warmup.ts); the loading screen stays up until it is done.
 */
function WarmUp() {
  const get = useThree((s) => s.get);
  // Once per match: the scene is complete when this boundary first commits.
  useLayoutEffect(() => {
    let live = true;
    const { gl, scene, camera } = get();
    useGame.getState().setWarming(true);
    warmUp(gl, scene, camera, { offscreen: useGame.getState().quality === 'high' })
      .catch(() => undefined)
      .finally(() => {
        if (live) useGame.getState().setWarming(false);
      });
    return () => {
      live = false;
      useGame.getState().setWarming(false);
    };
  }, [get]);
  return null;
}

/** Replay length in recorded seconds around the moment, by what happened. */
function replayWindow(kind: ReplayKind, release: number, contact: number | undefined, event: number | undefined): [number, number] {
  const e = event ?? release + 1;
  if (kind === 'bowled' || kind === 'lbw') return [release - 0.35, e + 1.3];
  const from = (contact ?? release) - (kind === 'runOut' ? 0.4 : 0.9);
  return [Math.max(release - 0.35, from), e + (kind === 'boundary' ? 0.6 : 1.0)];
}

// --- Driver ---------------------------------------------------------------------------

function Driver({ match, recorder }: { match: Match; recorder: ReplayRecorder }) {
  const steps = useRef(0);
  const meta = useRef<{ release: number; contact: number | undefined; event: number | undefined; off: 1 | -1 }>({ release: 0, contact: undefined, event: undefined, off: 1 });
  const replayedFor = useRef<unknown>(undefined);
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
        setSpeed: (speed: number) => {
          match.speed = speed;
        },
        setCamera: (view) => {
          debugView = view;
        },
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
    // Record this frame for a possible replay, and note the moments that matter.
    recorder.beginFrame(c, c?.time);
    if (c) {
      const ev = c.events.find((e) => e.type === 'stumps' || e.type === 'boundary' || e.type === 'pad' || e.type === 'body');
      meta.current = {
        release: c.releaseTime,
        contact: c.contact,
        event: c.outcome?.wicket?.kind === 'runOut' ? c.returnAt : c.outcome?.wicket?.kind === 'caught' ? c.collectedAt : ev ? c.releaseTime + ev.t : c.collectedAt,
        off: offSideSign(c.opts.striker.battingHand),
      };
    }
    // A wicket or a boundary: show the action replay before the card.
    const g = useGame.getState();
    if (match.phase === 'review' && !recorder.playing && match.lastOutcome && replayedFor.current !== match.lastOutcome) {
      replayedFor.current = match.lastOutcome;
      const o = match.lastOutcome;
      const kind: ReplayKind | undefined = o.wicket ? o.wicket.kind : o.boundary ? 'boundary' : undefined;
      if (kind && g.replaysOn && !g.paused) {
        const m = meta.current;
        const [from, to] = replayWindow(kind, m.release, m.contact, m.event);
        if (recorder.start(kind, from, to, m.off, m.contact)) g.setReplay(true, [...recorder.ids]);
      }
    }
    if (recorder.playing && !g.paused) {
      recorder.playT += delta * 0.45;
      if (recorder.playT >= recorder.endT) {
        recorder.stop();
        g.setReplay(false, []);
      }
    }
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
        else if (ev.type === 'contact' && ev.result.kind !== 'miss' && ev.result.kind !== 'leave')
          sound.bat({ quality: ev.result.quality, speed: ev.result.exitSpeed, edge: ev.result.kind === 'edge', along: ev.result.along, across: ev.result.across });
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
  /** Locomotion cycle position, in cycles (shared across walk/jog/run/sprint so switching keeps the feet in step). */
  cycle: number;
  /** When this player started celebrating (match time), if they are. */
  cheerFrom: number | undefined;
  pose: Pose;
}

const newMotion = (x: number, z: number): Motion => ({ pos: new Vector3(x, 0, z), facing: 0, phase: 0, cycle: 0, cheerFrom: undefined, pose: neutralPose() });

/** Natural speed (m/s) and cycle length (s) of each locomotion clip. */
const LOCOMOTION: readonly { name: ClipName; above: number; speed: number; duration: number }[] = [
  { name: 'sprint', above: 4.4, speed: 5.84, duration: 0.6 },
  { name: 'run', above: 2.75, speed: 3.07, duration: 0.7667 },
  { name: 'jog', above: 1.9, speed: 2.41, duration: 0.7667 },
  { name: 'walk', above: 0, speed: 1.4, duration: 1.0667 },
];

const avatarFor = (id: string): AvatarId => AVATARS[Math.abs(hash(id)) % AVATARS.length] ?? 'p1';
const toneFor = (id: string): number => (avatarFor(id) === 'p3' ? 0 : (Math.abs(hash(`${id}tone`)) % 5) / 5);

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
  // The control rig's gait stays underneath (arms that carry or gather use it).
  gait(m.pose, m.phase, Math.min(1, speed / sprint));
  const clip = LOCOMOTION.find((c) => speed > c.above) ?? LOCOMOTION[LOCOMOTION.length - 1];
  if (!clip) return;
  // Advance by distance travelled, so feet do not slide whatever the speed.
  m.cycle += moved / (clip.speed * clip.duration);
  m.pose.clip = { name: clip.name, time: (m.cycle % 1) * clip.duration };
}

/** Standing still: natural idle sway from motion capture. */
function idle(m: Motion, t: number, which: ClipName = 'idle'): void {
  resetPose(m.pose);
  m.pose.clip = { name: which, time: t };
}

const BAT_LENGTH = 0.86;
const SWEET_SPOT = 0.7;
const RUN_LANE = 1.25;
const END_Z = STRIKER_POPPING_Z + 0.35;

/** Where the bowler's bowling hand is this frame (written by Players, read by BallView). */
interface HandSpot {
  readonly pos: Vector3;
  ok: boolean;
}

function Players({ match, recorder, bowlerHand }: { match: Match; recorder: ReplayRecorder; bowlerHand: HandSpot }) {
  const fielding = match.bowlingSide;
  const batting = match.battingSide;
  const handles = useRef(new Map<string, HumanoidHandle | null>());
  const motions = useMemo(() => new Map<string, Motion>(), []);
  const strikerBat = useRef<Group>(null);
  const runnerBat = useRef<Group>(null);
  const batState = useMemo(() => ({ body: new Vector3(), hands: new Vector3(), dir: new Vector3(0, -1, 0) }), []);
  const look = useMemo(() => new Vector3(), []);
  const lastCycle = useRef<unknown>(null);
  const lastBowler = useRef('');
  const scratch = useMemo(() => ({ pose: neutralPose(), vectors: replayVectors() }), []);
  useEffect(
    () =>
      exposeDebug({
        players: () => ({
          bowler: match.bowler.id,
          mark: bowlerMark(match),
          at: [...motions].map(([id, m]) => ({ id, x: m.pos.x, z: m.pos.z })),
          field: match.field.map((f) => ({ id: f.player.id, x: f.start.x, z: f.start.z, role: f.position.id })),
        }),
      }),
    [match, motions],
  );

  useFrame((_, dtRaw) => {
    // Action replay: draw the recorded frame instead of the live match.
    if (recorder.playing) {
      const fr = recorder.frameAt(recorder.playT);
      if (!fr) return;
      for (const [id, h] of handles.current) {
        const snap = fr.poses.get(id);
        if (h && snap) h.apply(restorePose(snap, scratch.pose, scratch.vectors));
      }
      [strikerBat.current, runnerBat.current].forEach((bat, i) => {
        const b = fr.bats[i];
        if (!bat) return;
        bat.visible = b !== undefined;
        if (b) {
          bat.position.set(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0);
          bat.quaternion.set(b[3] ?? 0, b[4] ?? 0, b[5] ?? 0, b[6] ?? 1);
        }
      });
      return;
    }
    if (strikerBat.current) strikerBat.current.visible = true;
    if (runnerBat.current) runnerBat.current.visible = true;
    const dt = Math.min(0.05, dtRaw);
    const c = match.cycle;
    const t = match.time;
    const field = c?.opts.field ?? match.field;
    // When a ball ends (and when the next begins) the director cuts to the wide shot; under that
    // cut everyone is put back in their place, as on television — nobody wanders back across the screen.
    // The same when the bowler changes: the new one is at his mark, the old one in his fielding spot.
    const bowlerChanged = match.bowler.id !== lastBowler.current;
    const reset = c !== lastCycle.current || bowlerChanged;
    lastCycle.current = c;
    lastBowler.current = match.bowler.id;
    const geometry = bowlerGeometry(match);
    const wicket = c?.phase === 'dead' && c.outcome?.wicket !== undefined;
    const keeper = match.keeperOf(match.current.bowling);
    // Everyone watches the ball (or, before it is bowled, the bowler).
    const ballPos = c?.play?.ball.position;
    const bowlerMotion = motions.get(match.bowler.id);
    if (ballPos && c?.phase !== 'runUp') look.set(ballPos.x, ballPos.y, ballPos.z);
    else if (bowlerMotion) look.set(bowlerMotion.pos.x, 1.6, bowlerMotion.pos.z);
    // The ring walks in a pace or two as the bowler runs up.
    const walkIn = c?.phase === 'runUp' ? Math.min(1, c.time / c.releaseTime) : c?.phase === 'inFlight' ? 1 : 0;

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
      p.fade = undefined;
      const isBowler = f.position.id === 'bowler';
      // The bowler hands his cap to the umpire.
      h.headwear?.(!isBowler);
      if (reset && !isBowler) {
        m.pos.set(f.start.x, 0, f.start.z);
        m.facing = f.player.id === keeper.id ? Math.PI : Math.atan2(0 - f.start.x, STRIKER_STUMPS_Z - f.start.z);
      }
      if (reset && isBowler && !c) {
        const mark = bowlerMark(match);
        m.pos.set(mark.x, 0, mark.z);
        m.facing = 0;
      }
      const facingBatter = Math.atan2(0 - m.pos.x, STRIKER_STUMPS_Z - m.pos.z);
      if (isBowler) {
        poseBowler(match, m, dt, t);
      } else if (f.player.id === keeper.id) {
        const live = c && (c.phase === 'struck' || c.phase === 'dead') ? c.fielderPos[i] : undefined;
        const moved = live ? approach(m, live.x, live.z, 8, dt) : 0;
        if (moved > 0.01) stride(m, moved, dt, 8);
        else {
          const rise = c?.phase === 'inFlight' ? Math.min(1, c.flightTime / 0.5) : c && c.phase !== 'runUp' ? 1 : 0;
          keeperStance(p, rise);
          m.facing = turnTowards(m.facing, Math.PI, dt * 6);
        }
        if (c?.carrier === i) gather(p);
      } else {
        const live = c && (c.phase === 'struck' || c.phase === 'dead') ? c.fielderPos[i] : undefined;
        // Close catchers stay put; the ring walks in about two metres.
        const toBat = Math.hypot(f.start.x, f.start.z - STRIKER_STUMPS_Z);
        const inBy = toBat > 12 ? 1.2 * walkIn : 0;
        const homeX = f.start.x + ((0 - f.start.x) / Math.max(1, toBat)) * inBy;
        const homeZ = f.start.z + ((STRIKER_STUMPS_Z - f.start.z) / Math.max(1, toBat)) * inBy;
        // Between balls everyone stands still — unless the captain has just moved them, when they jog
        // to their new places; during the delivery the ring walks in slowly; once the ball is hit,
        // only the fielders the simulation moves (chaser, backer-up) go anywhere.
        const away = !c && Math.hypot(m.pos.x - f.start.x, m.pos.z - f.start.z) > 0.3;
        const moved = live ? approach(m, live.x, live.z, 9, dt) : c ? approach(m, homeX, homeZ, 0.9, dt) : away ? approach(m, f.start.x, f.start.z, 6.5, dt) : 0;
        if (moved > 0.004) stride(m, moved, dt, 8);
        else if (c && c.phase !== 'runUp') {
          readyStance(p, t + i);
          m.facing = turnTowards(m.facing, facingBatter, dt * 4);
        } else {
          idle(m, t * 0.8 + i * 1.7, i % 3 === 0 ? 'breathe' : 'idle');
          m.facing = turnTowards(m.facing, facingBatter, dt * 3);
        }
        if (c?.carrier === i) {
          const throwStart = (c.collectedAt ?? Infinity) + 0.55;
          if (c.returnAt !== undefined && c.runStarts.length > 0 && t >= (c.collectedAt ?? Infinity)) {
            const u = (c.time - (c.collectedAt ?? c.time)) / Math.max(0.3, throwStart + 0.35 - (c.collectedAt ?? 0));
            throwing(p, u, f.player.bowlingArm === 'right');
          } else gather(p);
          p.grip = 0.6;
        }
      }
      celebration(m, wicket && (!isBowler || c?.phase === 'dead'), t, i);
      if (!p.clip || p.clip.name === 'idle' || p.clip.name === 'breathe') p.look = look;
      p.x = m.pos.x;
      p.z = m.pos.z;
      p.facing = m.facing;
      h.apply(p);
      // The ball sits in the bowler's hand until it is released.
      if (isBowler) {
        h.handWorld(geometry.right ? 'R' : 'L', bowlerHand.pos);
        bowlerHand.ok = true;
      }
      recorder.pose(f.player.id, p);
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
      if (reset && !running) {
        if (id === strikerId) m.pos.set(-off * 0.45, 0, STRIKER_POPPING_Z + 0.22);
        else m.pos.set(geometry.nonStrikerX, 0, BOWLER_STUMPS_Z + 1.0);
        m.facing = id === strikerId ? (off > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
      }
      if (running) {
        const z = runnerZ(id === strikerId);
        const lane = id === strikerId ? RUN_LANE : -RUN_LANE;
        const moved = approach(m, lane * off, z, 10, dt);
        stride(m, moved, dt, 7.5);
        if (moved < 0.004) idle(m, t, 'breathe');
        p.grip = 0.9;
      } else if (id === strikerId) {
        poseStriker(match, m, batState, dt);
        p.grip = 1;
        p.look = look;
      } else {
        // Non-striker backs up as the bowler runs in, on the side away from his run.
        const backing = c?.phase === 'runUp' ? Math.min(1, c.time / c.releaseTime) : c ? 1 : 0;
        const moved = approach(m, geometry.nonStrikerX, BOWLER_STUMPS_Z + 1.0 + backing * 1.2, 3, dt);
        if (moved > 0.004) stride(m, moved, dt, 7.5);
        else {
          idle(m, t + 3, 'breathe');
          m.facing = turnTowards(m.facing, 0, dt * 4);
          p.look = look;
        }
        p.grip = 0.9;
      }
      p.x = m.pos.x;
      p.z = m.pos.z;
      p.facing = m.facing;
      h.apply(p);
      recorder.pose(id, p);
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
    const fr = recorder.current;
    if (fr) fr.bats = [sb, rb].map((b) => (b ? [...b.position.toArray(), ...b.quaternion.toArray()] : undefined));
  });

  const keeperId = match.keeperOf(match.current.bowling).id;
  // Stable kit objects: a new one would rebuild the player's model.
  const kits = useMemo(
    () => new Map(fielding.xi.map((p) => [p.id, kitFor(match, fielding.team, p, p.id === keeperId ? 'keeper' : 'fielder')])),
    [match, fielding, keeperId],
  );
  return (
    <group>
      {fielding.xi.map((p) => (
        <Cricketer
          key={p.id}
          kit={kits.get(p.id) ?? kitFor(match, fielding.team, p, 'fielder')}
          avatar={avatarFor(p.id)}
          tone={toneFor(p.id)}
          ref={(h) => {
            handles.current.set(p.id, h);
          }}
        />
      ))}
      {batting.xi.map((p) => (
        <BatterSlot key={p.id} match={match} player={p} team={batting.team} handles={handles} />
      ))}
      <Bat refObj={strikerBat} />
      <Bat refObj={runnerBat} />
    </group>
  );
}

/** Fielders celebrate a wicket with motion-captured cheers. */
function celebration(m: Motion, on: boolean, t: number, i: number): void {
  if (!on) {
    m.cheerFrom = undefined;
    return;
  }
  m.cheerFrom ??= t + (i % 4) * 0.12;
  const since = t - m.cheerFrom;
  if (since < 0) return;
  resetPose(m.pose);
  m.pose.clip = { name: i % 2 === 0 ? 'cheer' : 'cheer2', time: since + 0.4 };
}

const m0 = (m: Motion | undefined) => m?.facing ?? 0;
const easeRun = (u: number) => u * u * (3 - 2 * u) * 0.35 + u * 0.65;

/** Only the two batters at the crease are drawn. */
function BatterSlot({ match, player, team, handles }: { match: Match; player: Player; team: Team; handles: React.RefObject<Map<string, HumanoidHandle | null>> }) {
  // At the crease — or, while a replay plays, whoever was in it (a dismissed batter included).
  const atCrease = useGame((s) =>
    s.replaying ? s.replayIds.includes(player.id) : s.snap ? s.snap.striker.id === player.id || s.snap.nonStriker.id === player.id : false,
  );
  const kit = useMemo(() => kitFor(match, team, player, 'batter'), [match, team, player]);
  if (!atCrease) return null;
  return (
    <Cricketer
      kit={kit}
      avatar={avatarFor(player.id)}
      tone={toneFor(player.id)}
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

/** Which action a bowler uses. */
function actionKind(p: Player): ActionKind {
  switch (p.bowlingStyle) {
    case 'fast':
    case 'fastMedium':
      return 'pace';
    case 'offSpin':
      return 'offSpin';
    case 'legSpin':
      return 'legSpin';
    default:
      return 'medium';
  }
}

/**
 * Where the bowler runs: his mark, the line of his run, where his body is at
 * release (so the hand is over the release point the physics uses, over or
 * around the wicket), and which side the non-striker stands to keep out of
 * his way.
 */
function bowlerGeometry(match: Match): {
  kind: ActionKind;
  right: boolean;
  run: RunUp;
  mark: { x: number; z: number };
  release: { x: number; z: number };
  nonStrikerX: number;
} {
  const bowler = match.bowler;
  const right = bowler.bowlingArm === 'right';
  const run = runUpFor(bowler.bowlingStyle);
  const side = match.cycle?.plan.side ?? (match.humanBowling ? match.setup.side : 'over');
  const hand = releasePoint(bowler, side);
  // At release the arm is over the head (the trunk leans away from it), so the body is
  // only a little to the non-bowling side of the hand.
  const bodyX = hand.x + (right ? 0.06 : -0.06);
  const away = Math.sign(bodyX) || 1;
  return {
    kind: actionKind(bowler),
    right,
    run,
    mark: { x: bodyX + away * (0.6 + run.distance * 0.03), z: BOWLER_STUMPS_Z - run.distance },
    release: { x: bodyX, z: BOWLER_STUMPS_Z + 0.95 },
    nonStrikerX: -away * 1.3,
  };
}

/** Where the bowler stands before running in. */
function bowlerMark(match: Match): { x: number; z: number } {
  return bowlerGeometry(match).mark;
}

/**
 * The bowler: back to his mark between balls; the run-up (accelerating
 * strides from motion capture); the delivery stride and follow-through
 * (bowlingAction, keyed to the release time); then off to field.
 */
function poseBowler(match: Match, m: Motion, dt: number, t: number): void {
  const c = match.cycle;
  const g = bowlerGeometry(match);
  const p = m.pose;
  if (!c || match.phase !== 'delivery') {
    // Back to the mark between balls.
    const moved = approach(m, g.mark.x, g.mark.z, 2.6, dt);
    if (moved > 0.004) stride(m, moved, dt, 7);
    else {
      idle(m, t, 'breathe');
      m.facing = turnTowards(m.facing, 0, dt * 3);
    }
    return;
  }
  const tau = c.time - c.releaseTime;
  const span = actionSpan(g.kind);
  // Distance covered in the delivery stride (bound + stride): pace bowlers travel further.
  const strideLen = g.kind === 'pace' ? 2.6 : g.kind === 'medium' ? 2.2 : 1.4;
  if (tau < span.start) {
    // Run-up: from the mark to the start of the delivery stride, accelerating.
    const u = Math.min(1, Math.max(0, c.time / Math.max(0.1, c.releaseTime + span.start)));
    const s = g.kind === 'offSpin' || g.kind === 'legSpin' ? u : u * u * 0.45 + u * 0.55;
    const prev = tmpB.copy(m.pos);
    const startZ = g.release.z - strideLen;
    m.pos.set(g.mark.x + (g.release.x - g.mark.x) * s, 0, g.mark.z + (startZ - g.mark.z) * s);
    m.facing = Math.atan2(g.release.x - g.mark.x, startZ - g.mark.z) * 0.6;
    stride(m, prev.distanceTo(m.pos), dt, g.kind === 'pace' ? 8 : 6.5);
    return;
  }
  if (tau <= span.end) {
    // The delivery stride and follow-through, positioned along the release line.
    const k = Math.min(1, (tau - span.start) / -span.start);
    const z0 = g.release.z - strideLen;
    const zRelease = g.release.z;
    const follow = Math.max(0, tau) / span.end;
    m.pos.z = tau <= 0 ? z0 + (zRelease - z0) * k : zRelease + (g.kind === 'pace' ? 3.2 : 1.6) * (1 - (1 - follow) * (1 - follow));
    // After release, veer off the pitch (away from the danger area), as bowlers must.
    const veer = Math.sign(g.release.x) || 1;
    m.pos.x = g.release.x + (tau > 0 ? veer * 0.9 * follow * follow : 0);
    m.facing = turnTowards(m.facing, tau > 0 ? veer * 0.25 * follow : 0, dt * 10);
    bowlingAction(p, tau, g.kind, g.right);
    // Faster transition from the running clip into the action than the default cross-fade.
    p.fade = 0.12;
    return;
  }
  // Fielding wherever the plan sends him.
  const idx = c.opts.field.findIndex((f) => f.position.id === 'bowler');
  const target = c.fielderPos[idx];
  if (target) {
    const moved = approach(m, target.x, target.z, c.phase === 'inFlight' ? 3 : 8, dt);
    if (moved > 0.004) stride(m, moved, dt, 8);
    else readyStance(p, t);
  }
  if (c.carrier === idx) gather(p);
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
    const shoulder = new Vector3(m.pos.x + off * 0.08, 1.43 - p.drop, m.pos.z - 0.05);
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

// --- Wickets -------------------------------------------------------------------------------

/** Both sets of stumps; broken (stumps back, bails flying) when the ball or a throw hits them. */
function Wickets({ match, recorder }: { match: Match; recorder: ReplayRecorder }) {
  const strikerEnd = useRef<WicketHandle>(null);
  const bowlerEnd = useRef<WicketHandle>(null);
  const seen = useRef<unknown>(undefined);
  const live = useRef<(number[] | undefined)[]>([undefined, undefined]);
  const wasPlaying = useRef(false);
  useFrame((_, dtRaw) => {
    const ends = [strikerEnd.current, bowlerEnd.current];
    if (recorder.playing) {
      if (!wasPlaying.current) live.current = ends.map((w) => w?.capture());
      wasPlaying.current = true;
      const fr = recorder.frameAt(recorder.playT);
      ends.forEach((w, i) => {
        const st = fr?.wickets[i];
        if (w && st) w.restore(st);
      });
      return;
    }
    if (wasPlaying.current) {
      // Back from a replay: as they were.
      wasPlaying.current = false;
      ends.forEach((w, i) => {
        const st = live.current[i];
        if (w && st) w.restore(st);
      });
    }
    const dt = Math.min(0.05, dtRaw);
    const c = match.cycle;
    if (c !== seen.current) {
      seen.current = c;
      strikerEnd.current?.reset();
      bowlerEnd.current?.reset();
    }
    if (c) {
      const seed = match.history.length + 1;
      if (c.events.some((e) => e.type === 'stumps')) strikerEnd.current?.break(1, (c.delivery?.releaseSpeedKph ?? 120) / 150, seed);
      if (c.outcome?.wicket?.kind === 'runOut' && c.returnAt !== undefined && c.time >= c.returnAt) {
        if (c.throwTo === 'striker') strikerEnd.current?.break(1, 0.6, seed);
        else bowlerEnd.current?.break(-1, 0.6, seed);
      }
    }
    strikerEnd.current?.step(dt);
    bowlerEnd.current?.step(dt);
    const fr = recorder.current;
    if (fr) fr.wickets = ends.map((w) => w?.capture());
  });
  return (
    <>
      <Stumps ref={strikerEnd} z={STRIKER_STUMPS_Z} />
      <Stumps ref={bowlerEnd} z={BOWLER_STUMPS_Z} />
    </>
  );
}

// --- Umpires -------------------------------------------------------------------------------

const UMPIRE_KIT: Kit = { shirt: '#dde5ee', trim: '#1a2433', trousers: '#1f2633', skin: '#c58c64', headwear: 'hat', pads: false, gloves: 'none' };

type Signal = 'out' | 'four' | 'six' | 'wide' | 'noBall' | undefined;

/** The umpire's signal for the ball just completed, if any. */
function signalFor(match: Match): Signal {
  const o = match.cycle?.outcome;
  if (!o) return undefined;
  if (o.wicket && (o.wicket.kind === 'lbw' || o.wicket.kind === 'caught')) return 'out';
  if (o.boundary === 6) return 'six';
  if (o.boundary === 4) return 'four';
  if (o.wide) return 'wide';
  if (o.noBall) return 'noBall';
  return undefined;
}

function signal(p: Pose, s: Signal, t: number): void {
  if (!s) return;
  resetPose(p);
  if (s === 'out') {
    p.armR.pitch = 2.95;
    p.armR.roll = 0.05;
  } else if (s === 'six') {
    p.armL.pitch = p.armR.pitch = 2.95;
    p.armL.roll = p.armR.roll = 0.2;
  } else if (s === 'four') {
    // Waving across the chest.
    p.armR.pitch = 1.45;
    p.armR.roll = -0.6 + 0.8 * (0.5 + 0.5 * Math.sin(t * 7));
    p.armR.bend = 0.15;
  } else if (s === 'wide') {
    p.armL.roll = p.armR.roll = 1.5;
  } else {
    p.armR.roll = 1.5;
  }
}

/** One umpire behind the bowler's stumps, one at square leg. */
function Umpires({ match, recorder }: { match: Match; recorder: ReplayRecorder }) {
  const ends = useRef<(HumanoidHandle | null)[]>([null, null]);
  const motions = useMemo(() => [newMotion(-0.3, BOWLER_STUMPS_Z - 2.1), newMotion(-21, STRIKER_POPPING_Z)], []);
  const lastCycle = useRef<unknown>(null);
  const scratch = useMemo(() => ({ pose: neutralPose(), vectors: replayVectors() }), []);
  useFrame((_, dtRaw) => {
    if (recorder.playing) {
      const fr = recorder.frameAt(recorder.playT);
      ends.current.forEach((h, i) => {
        const snap = fr?.poses.get(`umpire-${i}`);
        if (h && snap) h.apply(restorePose(snap, scratch.pose, scratch.vectors));
      });
      return;
    }
    const dt = Math.min(0.05, dtRaw);
    const c = match.cycle;
    const reset = c !== lastCycle.current;
    lastCycle.current = c;
    const t = match.time;
    const off = offSideSign(match.striker.battingHand);
    const runSide = Math.sign(bowlerGeometry(match).release.x) || 1;
    const spots = [
      // Just behind the stumps, a little to the side away from the bowler's run (over or around).
      { x: -runSide * 0.3, z: BOWLER_STUMPS_Z - 2.1, facing: 0 },
      { x: -off * 21, z: STRIKER_POPPING_Z, facing: off > 0 ? Math.PI / 2 : -Math.PI / 2 },
    ];
    const sig = c?.phase === 'dead' ? signalFor(match) : undefined;
    motions.forEach((m, i) => {
      const h = ends.current[i];
      const spot = spots[i];
      if (!h || !spot) return;
      if (reset) {
        m.pos.set(spot.x, 0, spot.z);
        m.facing = spot.facing;
      }
      const moved = approach(m, spot.x, spot.z, 2.5, dt);
      if (moved > 0.004) stride(m, moved, dt, 6);
      else {
        idle(m, t * 0.9 + i * 4, 'idle');
        m.facing = turnTowards(m.facing, spot.facing, dt * 3);
        // Bending forward slightly, watching, as the bowler runs in.
        if (i === 0 && (c?.phase === 'runUp' || c?.phase === 'inFlight')) {
          resetPose(m.pose);
          m.pose.lean = 0.25;
          m.pose.drop = 0.05;
          m.pose.armL.pitch = m.pose.armR.pitch = 0.35;
          m.pose.armL.bend = m.pose.armR.bend = 0.9;
          m.pose.armL.roll = m.pose.armR.roll = -0.1;
        }
        if (i === 0) signal(m.pose, sig, t);
        else if (c?.outcome?.wicket?.kind === 'runOut' && c.phase === 'dead') signal(m.pose, 'out', t);
      }
      m.pose.look = undefined;
      m.pose.x = m.pos.x;
      m.pose.z = m.pos.z;
      m.pose.facing = m.facing;
      h.apply(m.pose);
      recorder.pose(`umpire-${i}`, m.pose);
    });
  });
  return (
    <>
      {[0, 1].map((i) => (
        <Cricketer
          key={i}
          kit={UMPIRE_KIT}
          avatar={i === 0 ? 'p4' : 'p1'}
          tone={i === 0 ? 0.55 : 0.2}
          ref={(h) => {
            ends.current[i] = h;
          }}
        />
      ))}
    </>
  );
}

// --- Ball ---------------------------------------------------------------------------------

/** Red leather with mottling and a raised, stitched seam round the equator. */
function ballTexture(): CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9e1418';
    ctx.fillRect(0, 0, w, h);
    const rng = new Rng('ball');
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(${rng.int(120, 190)}, ${rng.int(10, 40)}, ${rng.int(15, 40)}, ${rng.range(0.1, 0.35)})`;
      ctx.beginPath();
      ctx.arc(rng.range(0, w), rng.range(0, h), rng.range(1, 6), 0, Math.PI * 2);
      ctx.fill();
    }
    const mid = h / 2;
    ctx.fillStyle = '#6e0c10';
    ctx.fillRect(0, mid - 5, w, 10);
    // Six rows of stitching: three each side of the seam.
    ctx.fillStyle = '#efe3c2';
    for (const dy of [-11, -7.5, -4, 4, 7.5, 11]) {
      for (let x = 0; x < w; x += 6) ctx.fillRect(x, mid + dy - 1, 3.5, 2);
    }
    // Quarter seams.
    ctx.strokeStyle = 'rgba(80, 6, 10, 0.6)';
    ctx.lineWidth = 1.5;
    for (const x of [w * 0.25, w * 0.75]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Ball orientation: seam normal and spin, set at release from the delivery. */
interface BallSpin {
  readonly q: Quaternion;
  readonly axis: Vector3;
  rate: number;
  cycle: unknown;
  released: boolean;
}

const Y_AXIS = new Vector3(0, 1, 0);
const tmpAxis = new Vector3();
const tmpN = new Vector3();
const tmpDQ = new Quaternion();

/**
 * Sets the seam and spin at release, from the delivery as bowled:
 *  - pace: seam upright and still (the ball backspins about the seam's own
 *    axis), angled towards slip or fine leg by the swing it carries;
 *  - spin: the ball turns about its real spin axis (side spin along the
 *    line of flight, top spin across it), and the seam, set at an angle to
 *    that axis as a spinner's fingers leave it, visibly rotates;
 *  - the slower ball: a tumbling seam.
 * Rates are slowed for the eye (real revolutions alias at 60 fps).
 */
function releaseSpin(spin: BallSpin, c: NonNullable<Match['cycle']>): void {
  const d = c.delivery;
  spin.released = true;
  spin.cycle = c;
  if (!d) return;
  const mv = d.movement;
  const spinner = Math.abs(mv.spinSide) + Math.abs(mv.spinTop) > 6 && d.type.variable === 'spin';
  if (spinner) {
    // ω = top spin about +x, side spin about the line of flight (−side spin turns towards +x).
    spin.axis.set(mv.spinTop, 0, -mv.spinSide).normalize();
    if (spin.axis.lengthSq() < 0.5) spin.axis.set(1, 0, 0);
    const perp = tmpAxis.crossVectors(spin.axis, Y_AXIS);
    if (perp.lengthSq() < 1e-4) perp.set(0, 0, 1);
    perp.normalize();
    tmpN.copy(spin.axis).applyQuaternion(tmpDQ.setFromAxisAngle(perp, 0.65));
    spin.q.setFromUnitVectors(Y_AXIS, tmpN);
    spin.rate = 2.6;
    return;
  }
  if (d.type.id === 'slower') {
    spin.axis.set(0.8, 0.5, 0.35).normalize();
    spin.q.setFromUnitVectors(Y_AXIS, tmpN.set(1, 0, 0));
    spin.rate = 1.6;
    return;
  }
  // Seam angled to where it swings: φ up to ≈20°.
  const phi = Math.sign(mv.swingAccel) * Math.min(0.35, Math.abs(mv.swingAccel) * 0.07);
  tmpN.set(Math.cos(phi), 0, -Math.sin(phi));
  spin.q.setFromUnitVectors(Y_AXIS, tmpN);
  // Backspin about the seam's own axis: the seam stays put, the stitching blurs.
  spin.axis.copy(tmpN).negate();
  spin.rate = 7;
}

function BallView({ match, recorder, bowlerHand }: { match: Match; recorder: ReplayRecorder; bowlerHand: HandSpot }) {
  const ref = useRef<Group>(null);
  const orient = useRef<Group>(null);
  const out = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const texture = useMemo(ballTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const spin = useMemo<BallSpin>(() => ({ q: new Quaternion(), axis: new Vector3(1, 0, 0), rate: 0, cycle: undefined, released: false }), []);
  const fromHand = useMemo(() => new Vector3(), []);
  useEffect(
    () =>
      exposeDebug({
        bowlerHand: () => (bowlerHand.ok ? [bowlerHand.pos.x, bowlerHand.pos.y, bowlerHand.pos.z, match.cycle ? match.cycle.time - match.cycle.releaseTime : NaN] : undefined),
        ballWorld: () => {
          const m = ref.current;
          return m && m.visible ? [m.position.x, m.position.y, m.position.z] : undefined;
        },
      }),
    [bowlerHand, match],
  );
  useFrame((_, dtRaw) => {
    const mesh = ref.current;
    const o = orient.current;
    if (!mesh || !o) return;
    const dt = Math.min(0.1, dtRaw);
    if (recorder.playing) {
      const fr = recorder.frameAt(recorder.playT);
      if (fr) {
        mesh.position.set(fr.ball[0] ?? 0, fr.ball[1] ?? 0, fr.ball[2] ?? 0);
        mesh.visible = fr.ballVisible;
        if (fr.ball.length >= 7) o.quaternion.set(fr.ball[3] ?? 0, fr.ball[4] ?? 0, fr.ball[5] ?? 0, fr.ball[6] ?? 1);
      }
      return;
    }
    // Recorded at the end of this frame's update.
    const rec = () => {
      const fr = recorder.current;
      if (fr) {
        fr.ball = [...mesh.position.toArray(), ...o.quaternion.toArray()];
        fr.ballVisible = mesh.visible;
      }
    };
    queueMicrotask(rec);
    const c = match.cycle;
    if (!c || c.phase === 'runUp') {
      // In the bowler's hand, seam upright down the pitch, until he lets it go.
      mesh.visible = c !== undefined && bowlerHand.ok;
      if (bowlerHand.ok) mesh.position.copy(bowlerHand.pos);
      spin.q.setFromUnitVectors(Y_AXIS, tmpN.set(1, 0, 0));
      o.quaternion.copy(spin.q);
      spin.released = false;
      fromHand.copy(mesh.position);
      return;
    }
    if (!spin.released || spin.cycle !== c) releaseSpin(spin, c);
    mesh.visible = true;
    const play = c.play;
    // Once it has been hit, or is rolling, it simply rolls along its path.
    const v = play?.ball.velocity;
    if (v && (c.phase !== 'inFlight' || c.contact !== undefined)) {
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.2) {
        spin.axis.crossVectors(Y_AXIS, tmpAxis.set(v.x, 0, v.z)).normalize();
        spin.rate = Math.min(9, speed * 0.5);
      } else spin.rate = 0;
    }
    if (spin.rate > 0) {
      spin.q.premultiply(tmpDQ.setFromAxisAngle(spin.axis, spin.rate * Math.PI * 2 * dt));
      o.quaternion.copy(spin.q);
    }
    if (play && c.carrier === undefined && c.phase !== 'dead') {
      const a = match.clock.alpha;
      const p0 = play.previous;
      const p1 = play.ball.position;
      mesh.position.set(p0.x + (p1.x - p0.x) * a, p0.y + (p1.y - p0.y) * a, p0.z + (p1.z - p0.z) * a);
      // Leaving the hand: ease from where the hand was to the physics' release point.
      const since = c.flightTime;
      if (since < 0.07 && bowlerHand.ok) mesh.position.lerp(fromHand, 1 - since / 0.07);
      return;
    }
    c.ballPosition(out);
    mesh.position.set(out.x, out.y, out.z);
  });
  // Drawn larger than life (as most cricket games do) so it can be followed from the broadcast camera.
  const r = FIELD.ballRadius * 1.35;
  return (
    <group ref={ref}>
      <group ref={orient}>
        <mesh castShadow>
          <sphereGeometry args={[r, 32, 20]} />
          <meshPhysicalMaterial map={texture} roughness={0.42} clearcoat={0.7} clearcoatRoughness={0.25} />
        </mesh>
        {/* The seam: a raised, stitched ring, exaggerated so it reads at broadcast distance. */}
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[r * 1.005, r * 0.13, 6, 40]} />
          <meshStandardMaterial color="#f3ead0" roughness={0.55} emissive="#3a2f1a" emissiveIntensity={0.25} />
        </mesh>
      </group>
    </group>
  );
}

// --- Markers ---------------------------------------------------------------------------------

/** Length bands drawn on the pitch while placing the marker: [from, to] metres from the stumps. */
const LENGTH_BANDS: readonly (readonly [number, number, string])[] = [
  [0.3, 1.3, '#ef7b6b'],
  [1.3, 3.2, '#e3c062'],
  [3.2, 6.5, '#7fd49b'],
  [6.5, 8.8, '#e3c062'],
  [8.8, 12.5, '#ef7b6b'],
];

/**
 * The landing marker for a human bowler: a ring with a crosshair where the
 * ball should pitch, drawn above the pitch so nothing hides it. Dim while
 * the delivery is chosen, bright and pulsing while it is placed (with the
 * length bands shown), green once locked for the run-up. After the ball
 * pitches, a scuff marks where it actually landed.
 */
function Markers({ match }: { match: Match }) {
  const pitchMark = useRef<Mesh>(null);
  const target = useRef<Group>(null);
  const bands = useRef<Group>(null);
  const mats = useMemo(
    () => ({
      ring: new MeshBasicMaterial({ color: '#ffd23f', transparent: true, depthWrite: false, toneMapped: false }),
      cross: new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame((state) => {
    const c = match.cycle;
    const pm = pitchMark.current;
    if (pm) {
      const bounce = c?.events.find((e) => e.type === 'bounce' && !e.struck);
      if (bounce && bounce.type === 'bounce') {
        pm.visible = true;
        pm.position.set(bounce.x, 0.018, bounce.z);
      } else pm.visible = false;
    }
    const tm = target.current;
    const bandGroup = bands.current;
    if (!tm || !bandGroup) return;
    const aiming = match.humanBowling && match.phase === 'aiming';
    const running = match.humanBowling && match.phase === 'delivery' && c?.phase === 'runUp';
    tm.visible = aiming || running;
    const placing = aiming && match.aimStep === 'target';
    bandGroup.visible = placing;
    if (!tm.visible) return;
    const off = offSideSign(match.striker.battingHand);
    tm.position.set(match.setup.line * off, 0.02, STRIKER_STUMPS_Z - match.setup.length);
    const pulse = placing ? 1 + Math.sin(state.clock.elapsedTime * 6) * 0.08 : 1;
    tm.scale.setScalar(pulse);
    mats.ring.color.set(running ? '#7fd49b' : '#ffd23f');
    mats.ring.opacity = aiming && !placing ? 0.55 : 0.95;
    mats.cross.opacity = aiming && !placing ? 0.35 : 0.85;
  });
  return (
    <group>
      <mesh ref={pitchMark} rotation-x={-Math.PI / 2} visible={false} renderOrder={2}>
        <circleGeometry args={[0.09, 20]} />
        <meshBasicMaterial color="#4a2f14" transparent opacity={0.75} depthWrite={false} />
      </mesh>
      <group ref={target} visible={false}>
        <mesh rotation-x={-Math.PI / 2} material={mats.ring} renderOrder={3}>
          <ringGeometry args={[0.27, 0.4, 48]} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} material={mats.ring} renderOrder={3}>
          <circleGeometry args={[0.07, 16]} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} material={mats.cross} renderOrder={3}>
          <planeGeometry args={[1.2, 0.035]} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2} material={mats.cross} renderOrder={3}>
          <planeGeometry args={[1.2, 0.035]} />
        </mesh>
      </group>
      <group ref={bands} visible={false}>
        {LENGTH_BANDS.map(([from, to, color]) => (
          <mesh key={from} rotation-x={-Math.PI / 2} position={[0, 0.012, STRIKER_STUMPS_Z - (from + to) / 2]} renderOrder={1}>
            <planeGeometry args={[FIELD.pitchWidth * 0.98, to - from - 0.04]} />
            <meshBasicMaterial color={color} transparent opacity={0.13} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// --- Camera ----------------------------------------------------------------------------------

// The alternative views (C cycles): from behind the striker, and a high wide view.
const BATTER_END = { pos: new Vector3(0, 2.1, STRIKER_STUMPS_Z + 7), target: new Vector3(0, 1.0, BOWLER_STUMPS_Z), fov: 40 };
const HIGH = { pos: new Vector3(0, 48, BOWLER_STUMPS_Z - 40), target: new Vector3(0, 0, 8), fov: 45 };

/** A camera pinned from the debug handle (close-up captures in tests). */
let debugView: { pos: [number, number, number]; look: [number, number, number]; fov: number } | undefined;

function CameraRig({ match, recorder }: { match: Match; recorder: ReplayRecorder }) {
  const camera = useThree((s) => s.camera);
  const mode = useGame((s) => s.camera);
  const look = useMemo(() => new Vector3(WIDE.look.x, WIDE.look.y, WIDE.look.z), []);
  const pos = useMemo(() => new Vector3(WIDE.pos.x, WIDE.pos.y, WIDE.pos.z), []);
  const last = useRef<Shot['name'] | undefined>(undefined);
  const shake = useRef(0);
  const lastMode = useRef(mode);
  const replayWas = useRef(false);
  useFrame((state, dt) => {
    if (debugView) {
      camera.position.set(...debugView.pos);
      camera.lookAt(...debugView.look);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = debugView.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }
    if (recorder.playing) {
      replayCamera(recorder, camera, pos, look, !replayWas.current, dt);
      replayWas.current = true;
      last.current = 'hold';
      return;
    }
    replayWas.current = false;
    const c = match.cycle;
    const wantPos = tmpA;
    const wantLook = tmpB;
    let fov: number;
    let ease: number;
    let cut = false;
    if (mode === 'broadcast' || mode === 'classic') {
      const live = c && match.phase === 'delivery' ? c : undefined;
      const ball = live?.play?.ball.position;
      const stumps = live?.events.find((e) => e.type === 'stumps');
      let chaser: { x: number; z: number } | undefined;
      if (live && ball && live.phase !== 'runUp') {
        const idx = live.carrier ?? nearest(live.fielderPos, ball.x, ball.z);
        chaser = idx === undefined ? undefined : live.fielderPos[idx];
      }
      const shot = direct({
        style: mode === 'classic' ? 'classic' : 'tv',
        phase: live?.phase,
        time: live?.time ?? 0,
        releaseTime: live?.releaseTime ?? 1.7,
        contactTime: live?.contact,
        stumpsTime: stumps ? (live?.releaseTime ?? 0) + stumps.t : undefined,
        ball: ball ? { x: ball.x, y: ball.y, z: ball.z } : undefined,
        chaser: chaser ? { x: chaser.x, y: 0, z: chaser.z } : undefined,
        previous: last.current,
        humanBowling: match.humanBowling,
      });
      last.current = shot.name;
      wantPos.set(shot.pos.x, shot.pos.y, shot.pos.z);
      wantLook.set(shot.look.x, shot.look.y, shot.look.z);
      fov = shot.fov;
      ease = shot.ease;
      cut = shot.cut;
      // A long lens on a tripod is never perfectly still.
      const t = state.clock.elapsedTime;
      shake.current = shot.name === 'runUp' || shot.name === 'delivery' ? 1 : 0.4;
      wantLook.x += Math.sin(t * 0.7) * 0.03 * shake.current;
      wantLook.y += Math.sin(t * 0.9 + 1) * 0.02 * shake.current;
    } else {
      const preset = mode === 'batter' ? BATTER_END : HIGH;
      wantPos.copy(preset.pos);
      wantLook.copy(preset.target);
      fov = preset.fov;
      ease = 2.5;
      cut = lastMode.current !== mode;
      last.current = undefined;
    }
    lastMode.current = mode;
    const k = cut ? 1 : 1 - Math.exp(-dt * ease);
    pos.lerp(wantPos, k);
    look.lerp(wantLook, k);
    camera.position.copy(pos);
    camera.lookAt(look);
    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * k;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * The replay camera. Bowled and LBW: low and square to the striker's crease,
 * so you see the ball beat the bat and hit the stumps or pad. Everything
 * else: from behind the striker, then following the ball.
 */
function replayCamera(rec: ReplayRecorder, camera: PerspectiveCamera | Camera, pos: Vector3, look: Vector3, cut: boolean, dt: number): void {
  const fr = rec.frameAt(rec.playT);
  if (!fr) return;
  const ball = tmpA.set(fr.ball[0] ?? 0, fr.ball[1] ?? 0, fr.ball[2] ?? 0);
  let fov = 32;
  if (rec.kind === 'bowled' || rec.kind === 'lbw') {
    tmpB.set(rec.off * 7.5, 1.1, STRIKER_STUMPS_Z - 2.2);
    pos.lerp(tmpB, cut ? 1 : 1 - Math.exp(-dt * 6));
    look.lerp(tmpQLook.set(ball.x * 0.4, 0.55, Math.max(STRIKER_STUMPS_Z - 3, Math.min(STRIKER_STUMPS_Z, ball.z))), cut ? 1 : 1 - Math.exp(-dt * 8));
    fov = 30;
  } else {
    const struck = rec.contactT !== undefined && fr.t >= rec.contactT;
    if (!struck) {
      tmpB.set(0, 2.3, STRIKER_STUMPS_Z + 8);
      tmpQLook.set(0, 1.0, BOWLER_STUMPS_Z);
      fov = 34;
    } else {
      const d = Math.hypot(ball.x, ball.z - STRIKER_STUMPS_Z);
      // Rise with a lofted ball but aim below it, so the frame keeps the ground
      // (and the fielders under it) rather than a patch of sky.
      tmpB.set(ball.x * 0.35, 4 + Math.min(16, d * 0.25) + Math.min(10, ball.y * 0.5), STRIKER_STUMPS_Z + 9 + Math.min(10, d * 0.1));
      tmpQLook.set(ball.x, Math.min(ball.y * 0.5, 6), ball.z);
      fov = Math.min(60, 30 + d * 0.35 + Math.max(0, ball.y - 6) * 0.6);
    }
    pos.lerp(tmpB, cut ? 1 : 1 - Math.exp(-dt * 3));
    look.lerp(tmpQLook, cut ? 1 : 1 - Math.exp(-dt * 6));
  }
  camera.position.copy(pos);
  camera.lookAt(look);
  if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 0.01) {
    camera.fov += (fov - camera.fov) * (cut ? 1 : 1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
  }
}

const tmpQLook = new Vector3();

function nearest(points: readonly { x: number; z: number }[], x: number, z: number): number | undefined {
  let best: number | undefined;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
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
