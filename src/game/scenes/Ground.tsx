import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, type InstancedMesh, Matrix4, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/rng.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';

const LINE_Y = 0.006;
const LINE_W = 0.05;
const CREASE_COLOR = '#f4f1e8';

/**
 * Mown outfield, generated procedurally: alternating stripes with soft
 * edges, blade-level grain and clover-dark patches. Returns colour and a
 * matching normal map so the stripes catch the light like real cut grass.
 */
function useOutfieldTextures(): { map: CanvasTexture; normal: CanvasTexture } {
  const textures = useMemo(() => {
    const size = 1024;
    const stripes = 8;
    const rng = new Rng('outfield');
    const color = document.createElement('canvas');
    color.width = size;
    color.height = size;
    const height = new Float32Array(size * size);
    const ctx = color.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(size, size);
      const d = img.data;
      // Low-frequency patchiness from a few overlapping blobs.
      const blobs = Array.from({ length: 40 }, () => ({ x: rng.range(0, size), y: rng.range(0, size), r: rng.range(40, 160), k: rng.range(-0.06, 0.06) }));
      // Evaluated on a coarse grid (it is smooth) and sampled per pixel.
      const G = 64;
      const coarse = new Float32Array(G * G);
      for (let gy = 0; gy < G; gy++) {
        for (let gx = 0; gx < G; gx++) {
          const x = ((gx + 0.5) / G) * size;
          const y = ((gy + 0.5) / G) * size;
          let patch = 0;
          for (const b of blobs) {
            const dx = Math.min(Math.abs(x - b.x), size - Math.abs(x - b.x));
            const dy = Math.min(Math.abs(y - b.y), size - Math.abs(y - b.y));
            const q = (dx * dx + dy * dy) / (b.r * b.r);
            if (q < 1) patch += b.k * (1 - q);
          }
          coarse[gy * G + gx] = patch;
        }
      }
      for (let y = 0; y < size; y++) {
        const stripe = (y / size) * stripes;
        const within = stripe - Math.floor(stripe);
        const light = Math.floor(stripe) % 2 === 0;
        // Soft transition between stripes.
        const edge = Math.min(1, Math.min(within, 1 - within) * 14);
        const lightness = light ? 0.5 + 0.5 * edge : 0.5 - 0.5 * edge;
        for (let x = 0; x < size; x++) {
          const patch = coarse[Math.floor((y / size) * G) * G + Math.floor((x / size) * G)] ?? 0;
          const grain = (rng.next() - 0.5) * 0.12;
          const v = 0.9 + lightness * 0.11 + grain + patch;
          const i = (y * size + x) * 4;
          d[i] = Math.max(0, Math.min(255, 58 * v));
          d[i + 1] = Math.max(0, Math.min(255, 118 * v + 6 * grain * 40));
          d[i + 2] = Math.max(0, Math.min(255, 44 * v));
          d[i + 3] = 255;
          // Blades lean with the mowing direction: stripes differ in slope.
          height[y * size + x] = grain * 0.8 + (light ? 0.06 : -0.06) * Math.sin(x * 0.9);
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    const normal = document.createElement('canvas');
    normal.width = size;
    normal.height = size;
    const nctx = normal.getContext('2d');
    if (nctx) {
      const img = nctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const h = (xx: number, yy: number) => height[((yy + size) % size) * size + ((xx + size) % size)] ?? 0;
          const dx = (h(x + 1, y) - h(x - 1, y)) * 2.5;
          const dy = (h(x, y + 1) - h(x, y - 1)) * 2.5;
          const len = Math.hypot(dx, dy, 1);
          const i = (y * size + x) * 4;
          d[i] = (-dx / len) * 127 + 128;
          d[i + 1] = (dy / len) * 127 + 128;
          d[i + 2] = (1 / len) * 127 + 128;
          d[i + 3] = 255;
        }
      }
      nctx.putImageData(img, 0, 0);
    }
    const map = new CanvasTexture(color);
    const nmap = new CanvasTexture(normal);
    for (const t of [map, nmap]) {
      t.wrapS = RepeatWrapping;
      t.wrapT = RepeatWrapping;
      t.repeat.set(5, 5);
      t.anisotropy = 8;
    }
    map.colorSpace = SRGBColorSpace;
    return { map, normal: nmap };
  }, []);
  useEffect(
    () => () => {
      textures.map.dispose();
      textures.normal.dispose();
    },
    [textures],
  );
  return textures;
}

/**
 * The pitch: rolled, dry clay with a thin covering of live grass down the
 * middle, hairline cracks, and the scuffed, darker areas where batters
 * stand and bowlers land.
 */
function usePitchTexture(): CanvasTexture {
  const texture = useMemo(() => {
    const w = 256;
    const h = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const rng = new Rng('pitch');
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#b49a62');
      g.addColorStop(0.2, '#c6ae78');
      g.addColorStop(0.5, '#cdb683');
      g.addColorStop(0.8, '#c6ae78');
      g.addColorStop(1, '#b49a62');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Live grass, thicker away from the ends.
      for (let i = 0; i < 26000; i++) {
        const y = rng.range(0, h);
        const fromEnd = Math.min(y, h - y) / (h / 2);
        if (!rng.chance(0.25 + 0.55 * fromEnd)) continue;
        ctx.fillStyle = `rgba(${rng.int(110, 140)}, ${rng.int(130, 160)}, ${rng.int(70, 90)}, ${rng.range(0.15, 0.4)})`;
        ctx.fillRect(rng.range(0, w), y, 1, rng.range(1, 3));
      }
      // Grain.
      for (let i = 0; i < 30000; i++) {
        const shade = rng.int(150, 215);
        ctx.fillStyle = `rgba(${shade}, ${shade - 25}, ${shade - 72}, ${rng.range(0.08, 0.3)})`;
        ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(1, 2.5), rng.range(1, 2.5));
      }
      // Hairline cracks.
      ctx.strokeStyle = 'rgba(90, 68, 38, 0.35)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 70; i++) {
        let x = rng.range(20, w - 20);
        let y = rng.range(0, h);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += rng.range(-14, 14);
          y += rng.range(-14, 14);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Batting areas and bowlers' footmarks at each end.
      for (const end of [140, h - 140]) {
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = `rgba(${rng.int(95, 120)}, ${rng.int(72, 90)}, 42, ${rng.range(0.05, 0.2)})`;
          const x = w / 2 + rng.boundedNormal(48);
          const y = end + rng.boundedNormal(80);
          ctx.beginPath();
          ctx.ellipse(x, y, rng.range(2, 7), rng.range(3, 10), rng.range(0, 3), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function Line({ x, z, width, length }: { x: number; z: number; width: number; length: number }) {
  return (
    <mesh position={[x, LINE_Y, z]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[width, length]} />
      <meshStandardMaterial color={CREASE_COLOR} roughness={0.9} />
    </mesh>
  );
}

/** Popping, bowling and return creases for one end. `dir` is +1 for the striker's end. */
function Creases({ dir }: { dir: 1 | -1 }) {
  const stumpsZ = dir * STRIKER_STUMPS_Z;
  const poppingZ = stumpsZ - dir * FIELD.poppingCreaseOffset;
  const returnLen = 2.44 + FIELD.poppingCreaseOffset;
  const returnZ = poppingZ + dir * (returnLen / 2);
  return (
    <group>
      <Line x={0} z={poppingZ} width={3.66} length={LINE_W} />
      <Line x={0} z={stumpsZ} width={2.64} length={LINE_W} />
      <Line x={FIELD.returnCreaseHalfSpacing} z={returnZ} width={LINE_W} length={returnLen} />
      <Line x={-FIELD.returnCreaseHalfSpacing} z={returnZ} width={LINE_W} length={returnLen} />
    </group>
  );
}

export function Ground() {
  const outfield = useOutfieldTextures();
  const pitch = usePitchTexture();
  const stadiumRadius = FIELD.boundaryRadius + 16;
  return (
    <group>
      {/* Outfield */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[stadiumRadius, 96]} />
        <meshStandardMaterial map={outfield.map} normalMap={outfield.normal} normalScale={[0.6, 0.6]} roughness={0.92} />
      </mesh>

      {/* Pitch strip */}
      <mesh position={[0, 0.003, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[FIELD.pitchWidth, FIELD.pitchLength + 4]} />
        <meshStandardMaterial map={pitch} roughness={0.95} />
      </mesh>

      <Creases dir={1} />
      <Creases dir={-1} />

      <Square />

      {/* The fielding circle, marked with white discs as on real grounds */}
      <CircleDiscs />

      {/* Boundary rope */}
      <mesh position={[0, 0.11, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[FIELD.boundaryRadius, 0.11, 10, 220]} />
        <meshStandardMaterial color="#f1ede2" roughness={0.6} />
      </mesh>

      {/* Sight screens */}
      {[1, -1].map((dir) => (
        <mesh key={dir} position={[0, 3, dir * (FIELD.boundaryRadius + 6)]} castShadow>
          <boxGeometry args={[16, 6, 0.4]} />
          <meshStandardMaterial color="#f2f2ee" roughness={0.8} />
        </mesh>
      ))}

    </group>
  );
}

/** White plastic discs around the 30-yard (27.43 m) circle, two metres apart along the arc. */
function CircleDiscs() {
  const ref = useRef<InstancedMesh>(null);
  const r = 27.43;
  const count = Math.round((2 * Math.PI * r) / 2.2);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(Math.sin(a) * r, 0.012, Math.cos(a) * r);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} receiveShadow>
      <circleGeometry args={[0.16, 16]} />
      <meshStandardMaterial color="#f4f1e8" roughness={0.5} />
    </instancedMesh>
  );
}

/**
 * The square: the block of prepared strips around the match pitch — slightly
 * paler, shorter grass with the faint scars of old pitches either side.
 */
function Square() {
  const texture = useMemo(() => {
    const w = 256;
    const h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const rng = new Rng('square');
    if (ctx) {
      ctx.fillStyle = 'rgba(150, 170, 90, 0.22)';
      ctx.fillRect(0, 0, w, h);
      // Old strips either side of the match pitch.
      const strip = w / 9;
      for (let i = 0; i < 9; i++) {
        if (i === 4) continue;
        const worn = rng.range(0.05, 0.22);
        ctx.fillStyle = `rgba(175, 160, 105, ${worn})`;
        ctx.fillRect(i * strip + 2, h * 0.12, strip - 4, h * 0.76);
        // Scuffed ends of an old pitch.
        ctx.fillStyle = `rgba(150, 125, 80, ${worn * 0.8})`;
        ctx.fillRect(i * strip + 4, h * 0.14, strip - 8, h * 0.06);
        ctx.fillRect(i * strip + 4, h * 0.8, strip - 8, h * 0.06);
      }
      // Soft edges.
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[FIELD.pitchWidth * 9, FIELD.pitchLength + 10]} />
      <meshStandardMaterial map={texture} transparent depthWrite={false} roughness={0.95} />
    </mesh>
  );
}
