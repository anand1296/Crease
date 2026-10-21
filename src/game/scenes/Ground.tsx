import { useEffect, useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/rng.ts';
import { FIELD, STRIKER_STUMPS_Z } from '../data/field.ts';

const LINE_Y = 0.006;
const LINE_W = 0.05;
const CREASE_COLOR = '#f4f1e8';

/** Mown-stripe outfield texture, generated procedurally (no external assets). */
function useOutfieldTexture(): CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const stripes = 8;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#3d7a33' : '#468a3a';
        ctx.fillRect(0, (i * canvas.height) / stripes, canvas.width, canvas.height / stripes);
      }
    }
    const tex = new CanvasTexture(canvas);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Worn pitch: tan base, speckle, and scuffed ends where bowlers land and batters stand. */
function usePitchTexture(): CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, '#b9a26c');
      g.addColorStop(0.5, '#cdb784');
      g.addColorStop(1, '#b9a26c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 1024);
      const rng = new Rng('pitch');
      for (let i = 0; i < 9000; i++) {
        const shade = rng.int(150, 205);
        ctx.fillStyle = `rgba(${shade}, ${shade - 25}, ${shade - 70}, ${rng.range(0.1, 0.35)})`;
        ctx.fillRect(rng.int(0, 127), rng.int(0, 1023), rng.int(1, 3), rng.int(1, 3));
      }
      // Footmarks and the batting areas at each end.
      for (const end of [70, 954]) {
        for (let i = 0; i < 260; i++) {
          ctx.fillStyle = `rgba(110, 82, 45, ${rng.range(0.08, 0.25)})`;
          const x = 64 + rng.boundedNormal(26);
          const y = end + rng.boundedNormal(40);
          ctx.beginPath();
          ctx.ellipse(x, y, rng.range(1, 4), rng.range(2, 6), 0, 0, Math.PI * 2);
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
  const outfield = useOutfieldTexture();
  const pitch = usePitchTexture();
  const stadiumRadius = FIELD.boundaryRadius + 16;
  return (
    <group>
      {/* Outfield */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[stadiumRadius, 96]} />
        <meshStandardMaterial map={outfield} roughness={1} />
      </mesh>

      {/* Pitch strip */}
      <mesh position={[0, 0.003, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[FIELD.pitchWidth, FIELD.pitchLength + 4]} />
        <meshStandardMaterial map={pitch} roughness={0.95} />
      </mesh>

      <Creases dir={1} />
      <Creases dir={-1} />

      {/* 30-yard circle */}
      <mesh position={[0, LINE_Y, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[27.43 - 0.06, 27.43 + 0.06, 128]} />
        <meshBasicMaterial color={CREASE_COLOR} transparent opacity={0.5} />
      </mesh>

      {/* Boundary rope */}
      <mesh position={[0, 0.07, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[FIELD.boundaryRadius, 0.07, 8, 160]} />
        <meshStandardMaterial color="#e8e3d6" />
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
