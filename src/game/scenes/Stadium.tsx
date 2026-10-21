import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  type InstancedMesh,
  Matrix4,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
} from 'three';
import { useGame } from '../../state/game.ts';
import { FIELD } from '../data/field.ts';
import { Rng } from '../core/rng.ts';

/**
 * The stadium around the field, all procedural: sky dome, tiered stands
 * with an instanced crowd (one draw call), roof, sponsor boards (fictional
 * brands) and floodlights, plus a big screen showing the live score.
 */
const STAND_R = 80;
const LOWER_ROWS = 14;
const UPPER_R = 96;
const UPPER_Y = 12;
const UPPER_ROWS = 10;
const ROW_DEPTH = 0.9;
const ROW_RISE = 0.55;
/** Angular gaps behind each sight screen (radians either side of the pitch line). */
const SCREEN_GAP = 0.2;

export function Stadium({ crowd }: { crowd: boolean }) {
  return (
    <group>
      <Sky />
      <Stands />
      {crowd ? <Crowd /> : null}
      <AdBoards />
      <Floodlights />
      <ScoreScreen />
    </group>
  );
}

function Sky() {
  const geometry = useMemo(() => {
    const g = new SphereGeometry(420, 32, 16);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const top = new Color('#3f78b8');
    const horizon = new Color('#cfe2f0');
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 420;
      c.copy(horizon).lerp(top, Math.min(1, Math.max(0, y * 1.6)));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

function tierProfile(r0: number, y0: number, rows: number): Vector2[] {
  const pts: Vector2[] = [new Vector2(r0 - 0.4, 0), new Vector2(r0 - 0.4, y0)];
  for (let i = 0; i <= rows; i++) {
    const r = r0 + i * ROW_DEPTH;
    const y = y0 + i * ROW_RISE;
    pts.push(new Vector2(r, y), new Vector2(r + ROW_DEPTH, y));
  }
  const last = pts[pts.length - 1];
  if (last) pts.push(new Vector2(last.x, last.y + 2.5), new Vector2(last.x + 0.5, last.y + 2.5));
  return pts;
}

function Stands() {
  const lower = useMemo(() => tierProfile(STAND_R, 1.6, LOWER_ROWS), []);
  const upper = useMemo(() => tierProfile(UPPER_R, UPPER_Y, UPPER_ROWS), []);
  const roofY = UPPER_Y + UPPER_ROWS * ROW_RISE + 6;
  return (
    <group>
      <mesh>
        <latheGeometry args={[lower, 96]} />
        <meshStandardMaterial color="#7d848f" roughness={0.95} side={DoubleSide} />
      </mesh>
      <mesh>
        <latheGeometry args={[upper, 96]} />
        <meshStandardMaterial color="#6c727c" roughness={0.95} side={DoubleSide} />
      </mesh>
      {/* Fascia between the tiers */}
      <mesh position={[0, UPPER_Y - 1.5, 0]}>
        <cylinderGeometry args={[UPPER_R - 0.3, UPPER_R - 0.3, 3, 96, 1, true]} />
        <meshStandardMaterial color="#1c2c44" roughness={0.6} side={BackSide} />
      </mesh>
      {/* Roof canopy */}
      <mesh position={[0, roofY, 0]} rotation-x={Math.PI / 2}>
        <ringGeometry args={[UPPER_R - 8, UPPER_R + UPPER_ROWS * ROW_DEPTH + 4, 96]} />
        <meshStandardMaterial color="#d9dde3" roughness={0.6} side={DoubleSide} />
      </mesh>
      {/* Low wall at the front of the stands */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[STAND_R - 0.5, STAND_R - 0.5, 1.6, 96, 1, true]} />
        <meshStandardMaterial color="#2c4f2a" roughness={0.9} side={BackSide} />
      </mesh>
    </group>
  );
}

const CROWD_COLORS = ['#f2f2f2', '#1f4e8c', '#8c1f2e', '#e2701d', '#5b2a86', '#f2c14e', '#2a2a2a', '#c94040', '#3b7a57', '#87a9d6', '#e8d9b5'];

/** One instanced mesh for every spectator; jumps up when something happens. */
function Crowd() {
  const ref = useRef<InstancedMesh>(null);
  const seats = useMemo(() => {
    const rng = new Rng('crowd');
    const out: { x: number; y: number; z: number; a: number; c: string; phase: number }[] = [];
    const tier = (r0: number, y0: number, rows: number, fill: number) => {
      for (let row = 0; row < rows; row++) {
        const r = r0 + row * ROW_DEPTH + ROW_DEPTH * 0.5;
        const y = y0 + row * ROW_RISE;
        const count = Math.floor((Math.PI * 2 * r) / 0.75);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          // Leave the seats behind the sight screens empty.
          const fromLine = Math.min(Math.abs(Math.sin(a)), 1);
          if (Math.abs(Math.cos(a)) > 0.9 && fromLine < SCREEN_GAP) continue;
          if (!rng.chance(fill)) continue;
          out.push({ x: Math.sin(a) * r, y, z: Math.cos(a) * r, a, c: CROWD_COLORS[rng.int(0, CROWD_COLORS.length - 1)] ?? '#fff', phase: rng.next() * 6.28 });
        }
      }
    };
    tier(STAND_R, 1.6, LOWER_ROWS, 0.72);
    tier(UPPER_R, UPPER_Y, UPPER_ROWS, 0.62);
    return out;
  }, []);
  const matrix = useMemo(() => new Matrix4(), []);
  const color = useMemo(() => new Color(), []);
  const excitement = useRef(0);
  const lastBall = useRef(0);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    seats.forEach((s, i) => {
      matrix.makeRotationY(s.a);
      matrix.setPosition(s.x, s.y + 0.32, s.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.set(s.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [seats, matrix, color]);

  useFrame((state, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const snap = useGame.getState().snap;
    if (snap && snap.ballCount !== lastBall.current) {
      lastBall.current = snap.ballCount;
      const o = snap.lastOutcome;
      if (o?.boundary || o?.wicket) excitement.current = 3;
    }
    if (excitement.current <= 0) return;
    excitement.current = Math.max(0, excitement.current - dt);
    const t = state.clock.elapsedTime;
    const k = Math.min(1, excitement.current);
    seats.forEach((s, i) => {
      matrix.makeRotationY(s.a);
      matrix.setPosition(s.x, s.y + 0.32 + Math.max(0, Math.sin(t * 9 + s.phase)) * 0.35 * k, s.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, seats.length]}>
      <boxGeometry args={[0.42, 0.62, 0.3]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  );
}

const SPONSORS: [string, string, string][] = [
  ['CREASE', '#0d1520', '#e0b23a'],
  ['SUNRISE COLA', '#c43b2d', '#ffffff'],
  ['HARBOUR BANK', '#1f4e8c', '#ffffff'],
  ['TOCK SPORTS', '#111111', '#7fe08a'],
  ['RIVERSIDE AIR', '#5b2a86', '#ffffff'],
  ['HIGHLAND TEA', '#2c5d34', '#f2c14e'],
];

function boardTexture([text, bg, fg]: [string, string, string]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = fg;
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 34);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Sponsor boards round the rope: one instanced mesh per sponsor (six draw calls, not sixty). */
function AdBoards() {
  const textures = useMemo(() => SPONSORS.map(boardTexture), []);
  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);
  const r = FIELD.boundaryRadius + 3;
  const count = 60;
  const width = ((Math.PI * 2 * r) / count) * 0.98;
  return (
    <group>
      {textures.map((tex, k) => (
        <BoardSet key={k} texture={tex} index={k} every={textures.length} count={count} radius={r} width={width} />
      ))}
    </group>
  );
}

function BoardSet({ texture, index, every, count, radius, width }: { texture: CanvasTexture; index: number; every: number; count: number; radius: number; width: number }) {
  const ref = useRef<InstancedMesh>(null);
  const angles = useMemo(() => Array.from({ length: count }, (_, i) => i).filter((i) => i % every === index).map((i) => (i / count) * Math.PI * 2), [count, every, index]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    angles.forEach((a, i) => {
      m.makeRotationY(a + Math.PI);
      m.setPosition(Math.sin(a) * radius, 0.45, Math.cos(a) * radius);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [angles, radius]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, angles.length]}>
      <planeGeometry args={[width, 0.9]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </instancedMesh>
  );
}

function Floodlights() {
  const towers = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  const R = UPPER_R + 16;
  return (
    <group>
      {towers.map((a) => (
        <group key={a} position={[Math.sin(a) * R, 0, Math.cos(a) * R]} rotation-y={a + Math.PI}>
          <mesh position={[0, 26, 0]}>
            <cylinderGeometry args={[0.6, 1.2, 52, 8]} />
            <meshStandardMaterial color="#9aa1aa" roughness={0.6} metalness={0.4} />
          </mesh>
          <mesh position={[0, 53, 0.8]} rotation-x={0.35}>
            <boxGeometry args={[10, 6, 0.6]} />
            <meshStandardMaterial color="#e8eef5" emissive="#fff8e0" emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Big screen behind the striker's end showing the live score. */
function ScoreScreen() {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);
  const snap = useGame((s) => s.snap);
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#e0b23a';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(snap ? snap.battingTeam.shortName : 'CREASE', 24, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.fillText(snap ? `${snap.runs}/${snap.wickets}` : '', 24, 150);
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillStyle = '#9fb3c8';
    if (snap) ctx.fillText(`Overs ${snap.overs} / ${snap.maxOvers}`, 24, 200);
    if (snap?.target !== undefined) ctx.fillText(`Target ${snap.target}`, 300, 200);
    if (snap?.lastOutcome) {
      ctx.fillStyle = snap.lastOutcome.wicket ? '#ef6b5b' : snap.lastOutcome.boundary ? '#5fd08a' : '#ffffff';
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.fillText(snap.lastOutcome.headline, 300, 52);
    }
    texture.needsUpdate = true;
  }, [snap, canvas, texture]);
  return (
    <group position={[-30, 20, UPPER_R + 4]} rotation-y={Math.PI}>
      <mesh>
        <planeGeometry args={[20, 10]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.2]}>
        <boxGeometry args={[21, 11, 0.3]} />
        <meshStandardMaterial color="#20262e" />
      </mesh>
    </group>
  );
}
