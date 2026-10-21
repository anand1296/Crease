import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide,
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
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
      <Stands />
      {crowd ? <Crowd /> : null}
      <AdBoards />
      <Floodlights />
      <ScoreScreen />
    </group>
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

/**
 * Rows of plastic seats for a tier's lathe (u runs round the ground, v up the
 * profile): coloured seat rows on concrete steps, with aisles every so often.
 */
function seatTexture(color: string, rows: number): CanvasTexture {
  const w = 512;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8a8f96';
    ctx.fillRect(0, 0, w, h);
    // The profile has the wall at the bottom of v and two points per row; rows occupy most of v.
    const rowH = (h * 0.86) / (rows + 1);
    for (let r = 0; r <= rows; r++) {
      const y = h * 0.1 + r * rowH;
      ctx.fillStyle = '#6e737a';
      ctx.fillRect(0, y + rowH * 0.62, w, rowH * 0.38);
      for (let x = 0; x < w; x += 16) {
        if (x % 128 < 16) continue; // aisle
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, y + rowH * 0.12, 12, rowH * 0.5);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x + 2, y + rowH * 0.5, 12, rowH * 0.12);
      }
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.repeat.set(24, 1);
  tex.anisotropy = 8;
  return tex;
}

function Stands() {
  const lower = useMemo(() => tierProfile(STAND_R, 1.6, LOWER_ROWS), []);
  const upper = useMemo(() => tierProfile(UPPER_R, UPPER_Y, UPPER_ROWS), []);
  const roofY = UPPER_Y + UPPER_ROWS * ROW_RISE + 6;
  const seats = useMemo(() => ({ lower: seatTexture('#1f5f9e', LOWER_ROWS), upper: seatTexture('#9e2a2b', UPPER_ROWS) }), []);
  useEffect(
    () => () => {
      seats.lower.dispose();
      seats.upper.dispose();
    },
    [seats],
  );
  return (
    <group>
      <mesh>
        <latheGeometry args={[lower, 96]} />
        <meshStandardMaterial map={seats.lower} roughness={0.85} side={DoubleSide} />
      </mesh>
      <mesh>
        <latheGeometry args={[upper, 96]} />
        <meshStandardMaterial map={seats.upper} roughness={0.85} side={DoubleSide} />
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

const SHIRTS = ['#f2f2f2', '#1f4e8c', '#8c1f2e', '#e2701d', '#5b2a86', '#f2c14e', '#2a2a2a', '#c94040', '#3b7a57', '#87a9d6', '#e8d9b5', '#1b2b4b', '#d64f8a', '#4aa3a2'];
const SKINS = ['#f1c9a5', '#e3b48f', '#c58c64', '#a8714c', '#8d5a3b', '#6b4128', '#5a3622'];
const HAIR = ['#1d1510', '#3b2618', '#6b4a2b', '#a77b4b', '#d8c08a', '#7a7a7a'];
const CELLS_X = 8;
const CELLS_Y = 4;

/**
 * Spectator sprite sheet, drawn procedurally: 32 people (head, hair or cap,
 * shoulders, shirt, some with arms raised or a flag), front-on and waist up.
 */
function crowdAtlas(): CanvasTexture {
  const cw = 64;
  const ch = 96;
  const canvas = document.createElement('canvas');
  canvas.width = cw * CELLS_X;
  canvas.height = ch * CELLS_Y;
  const ctx = canvas.getContext('2d');
  const rng = new Rng('crowd-atlas');
  const pick = <T,>(a: readonly T[]): T => a[rng.int(0, a.length - 1)] ?? (a[0] as T);
  if (ctx) {
    for (let cy = 0; cy < CELLS_Y; cy++) {
      for (let cx = 0; cx < CELLS_X; cx++) {
        const x0 = cx * cw;
        const y0 = cy * ch;
        const shirt = pick(SHIRTS);
        const skin = pick(SKINS);
        const armsUp = rng.chance(0.25);
        // Arms (behind the body when raised).
        ctx.fillStyle = skin;
        if (armsUp) {
          ctx.save();
          ctx.translate(x0 + cw / 2, y0 + ch * 0.5);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.rotate(side * 0.35);
            ctx.fillStyle = shirt;
            ctx.fillRect(side * 16 - 5, -46, 10, 30);
            ctx.fillStyle = skin;
            ctx.beginPath();
            ctx.arc(side * 16, -50, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          ctx.restore();
          if (rng.chance(0.3)) {
            ctx.fillStyle = pick(SHIRTS);
            ctx.fillRect(x0 + 6, y0 + 4, cw - 12, 16);
          }
        }
        // Torso with shoulders.
        ctx.fillStyle = shirt;
        ctx.beginPath();
        ctx.moveTo(x0 + 10, y0 + ch);
        ctx.lineTo(x0 + 12, y0 + ch * 0.5);
        ctx.quadraticCurveTo(x0 + 14, y0 + ch * 0.42, x0 + 24, y0 + ch * 0.41);
        ctx.lineTo(x0 + cw - 24, y0 + ch * 0.41);
        ctx.quadraticCurveTo(x0 + cw - 14, y0 + ch * 0.42, x0 + cw - 12, y0 + ch * 0.5);
        ctx.lineTo(x0 + cw - 10, y0 + ch);
        ctx.closePath();
        ctx.fill();
        // Shading down the sides.
        const g = ctx.createLinearGradient(x0 + 10, 0, x0 + cw - 10, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.25)');
        g.addColorStop(0.5, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(x0 + 10, y0 + ch * 0.41, cw - 20, ch * 0.59);
        // Neck and head.
        ctx.fillStyle = skin;
        ctx.fillRect(x0 + cw / 2 - 5, y0 + ch * 0.34, 10, 8);
        ctx.beginPath();
        ctx.ellipse(x0 + cw / 2, y0 + ch * 0.27, 10, 12.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Hair or a cap.
        if (rng.chance(0.3)) {
          ctx.fillStyle = pick(SHIRTS);
          ctx.beginPath();
          ctx.ellipse(x0 + cw / 2, y0 + ch * 0.2, 11, 7, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillRect(x0 + cw / 2 - 11, y0 + ch * 0.2 - 1, 22, 3);
        } else {
          ctx.fillStyle = pick(HAIR);
          ctx.beginPath();
          ctx.ellipse(x0 + cw / 2, y0 + ch * 0.22, 10.5, 8, 0, Math.PI, 0);
          ctx.fill();
        }
      }
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Every spectator as one instanced, alpha-tested sprite (one draw call).
 * Each picks a cell of the sprite sheet; when something happens they jump,
 * animated on the GPU.
 */
function Crowd() {
  const ref = useRef<InstancedMesh>(null);
  const atlas = useMemo(crowdAtlas, []);
  useEffect(() => () => atlas.dispose(), [atlas]);
  const seats = useMemo(() => {
    const rng = new Rng('crowd');
    const out: { x: number; y: number; z: number; a: number; cell: number; phase: number; scale: number }[] = [];
    const tier = (r0: number, y0: number, rows: number, fill: number) => {
      for (let row = 0; row < rows; row++) {
        const r = r0 + row * ROW_DEPTH + ROW_DEPTH * 0.5;
        const y = y0 + row * ROW_RISE;
        const count = Math.floor((Math.PI * 2 * r) / 0.62);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + rng.range(-0.002, 0.002);
          // Leave the seats behind the sight screens empty.
          const fromLine = Math.min(Math.abs(Math.sin(a)), 1);
          if (Math.abs(Math.cos(a)) > 0.9 && fromLine < SCREEN_GAP) continue;
          if (!rng.chance(fill)) continue;
          out.push({ x: Math.sin(a) * r, y, z: Math.cos(a) * r, a, cell: rng.int(0, CELLS_X * CELLS_Y - 1), phase: rng.next() * 6.28, scale: rng.range(0.9, 1.08) });
        }
      }
    };
    tier(STAND_R, 1.6, LOWER_ROWS, 0.82);
    tier(UPPER_R, UPPER_Y, UPPER_ROWS, 0.74);
    return out;
  }, []);
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: DoubleSide });
    const uniforms = { uTime: { value: 0 }, uJump: { value: 0 } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float cell;
attribute float phase;
uniform float uTime;
uniform float uJump;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
vMapUv = (vec2(mod(cell, ${CELLS_X}.0), floor(cell / ${CELLS_X}.0)) + vMapUv) / vec2(${CELLS_X}.0, ${CELLS_Y}.0);`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
transformed.y += max(0.0, sin(uTime * 9.0 + phase)) * 0.32 * uJump;`,
        );
    };
    m.customProgramCacheKey = () => 'crease-crowd-v1';
    return { m, uniforms };
  }, [atlas]);
  useEffect(() => () => material.m.dispose(), [material]);
  const excitement = useRef(0);
  const lastBall = useRef(0);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const scale = new Matrix4();
    const cells = new Float32Array(seats.length);
    const phases = new Float32Array(seats.length);
    seats.forEach((s, i) => {
      // Facing the middle of the ground.
      matrix.makeRotationY(s.a + Math.PI);
      scale.makeScale(s.scale, s.scale, s.scale);
      matrix.multiply(scale);
      matrix.setPosition(s.x, s.y + 0.55 * s.scale, s.z);
      mesh.setMatrixAt(i, matrix);
      // Sheet rows run top to bottom; texture v runs bottom to top.
      const col = s.cell % CELLS_X;
      const row = CELLS_Y - 1 - Math.floor(s.cell / CELLS_X);
      cells[i] = row * CELLS_X + col;
      phases[i] = s.phase;
    });
    mesh.geometry.setAttribute('cell', new InstancedBufferAttribute(cells, 1));
    mesh.geometry.setAttribute('phase', new InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.needsUpdate = true;
  }, [seats]);

  useFrame((state, dt) => {
    const snap = useGame.getState().snap;
    if (snap && snap.ballCount !== lastBall.current) {
      lastBall.current = snap.ballCount;
      const o = snap.lastOutcome;
      if (o?.boundary || o?.wicket) excitement.current = 3.5;
    }
    excitement.current = Math.max(0, excitement.current - dt);
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uJump.value = Math.min(1, excitement.current);
  });

  return (
    <instancedMesh ref={ref} args={[undefined, material.m, seats.length]} frustumCulled={false}>
      <planeGeometry args={[0.6, 0.9]} />
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
