import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, DoubleSide, type InstancedMesh, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import type { Venue } from '../data/venues.ts';
import { Rng } from '../core/rng.ts';

/**
 * The buildings that make a ground recognisable: Lord's Pavilion (behind the
 * bowler's end, as at the Pavilion End), the Media Centre raised on its two
 * legs above the far end (where the broadcast camera sees it behind the
 * batter), the tented roofs of the Mound Stand, plane trees beyond the low
 * stands; Wankhede's crown of white fabric canopies. Impressions, drawn from
 * simple shapes.
 */
export function Landmarks({ venue, night }: { venue: Venue; night: boolean }) {
  const has = (l: Venue['landmarks'][number]) => venue.landmarks.includes(l);
  const top = venue.tiers.reduce((a, t) => Math.max(a, t.y + t.rows * 0.55), 0);
  const outer = venue.tiers.reduce((a, t) => Math.max(a, t.r + t.rows * 0.9), 0);
  return (
    <group>
      {has('pavilion') ? <Pavilion night={night} /> : null}
      {has('mediaCentre') ? <MediaCentre night={night} /> : null}
      {has('moundCanopies') ? <Canopies at={Math.PI / 2} r={96} y={top + 2.5} count={7} span={1.0} /> : null}
      {has('trees') ? <Trees /> : null}
      {has('sails') ? <Sails r={outer - 5} y={top + 2} count={24} /> : null}
    </group>
  );
}

/** Red brick, three floors of tall windows behind white balconies. */
function facadeTexture(): CanvasTexture {
  const w = 1024;
  const h = 320;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#9b4a32';
    g.fillRect(0, 0, w, h);
    // Brick courses.
    g.fillStyle = 'rgba(255,230,210,0.08)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
    // Stone bands between the floors and a cornice.
    g.fillStyle = '#e4d6bd';
    for (const y of [8, 108, 208, 300]) g.fillRect(0, y, w, 7);
    // Windows: tall, round-headed, in bays.
    for (let floor = 0; floor < 3; floor++) {
      const y0 = 26 + floor * 100;
      for (let x = 24; x < w - 24; x += 48) {
        g.fillStyle = '#e4d6bd';
        g.fillRect(x - 3, y0 - 3, 28, 64);
        g.fillStyle = '#26323d';
        g.beginPath();
        g.moveTo(x, y0 + 60);
        g.lineTo(x, y0 + 11);
        g.arc(x + 11, y0 + 11, 11, Math.PI, 0);
        g.lineTo(x + 22, y0 + 60);
        g.closePath();
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x + 10, y0 + 6, 2, 54);
      }
      // A white balcony rail along each floor.
      g.fillStyle = '#f2f0ea';
      g.fillRect(0, y0 + 62, w, 4);
      for (let x = 0; x < w; x += 8) g.fillRect(x, y0 + 52, 2, 12);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function Pavilion({ night }: { night: boolean }) {
  const facade = useMemo(facadeTexture, []);
  useEffect(() => () => facade.dispose(), [facade]);
  const R = 92;
  const glow = night ? 0.35 : 0;
  return (
    <group position={[0, 0, -R]}>
      {/* The main block, facing the field. */}
      <mesh position={[0, 9, 0]}>
        <boxGeometry args={[60, 18, 16]} />
        <meshStandardMaterial attach="material-0" color="#8f4430" roughness={0.85} />
        <meshStandardMaterial attach="material-1" color="#8f4430" roughness={0.85} />
        <meshStandardMaterial attach="material-2" color="#4a4f57" roughness={0.8} />
        <meshStandardMaterial attach="material-3" color="#8f4430" roughness={0.85} />
        <meshStandardMaterial attach="material-4" map={facade} roughness={0.8} emissive="#ffd9a0" emissiveIntensity={glow} />
        <meshStandardMaterial attach="material-5" color="#8f4430" roughness={0.85} />
      </mesh>
      {/* Members' seats in front. */}
      <mesh position={[0, 1.2, 10]} rotation-x={-0.5}>
        <boxGeometry args={[56, 0.4, 6]} />
        <meshStandardMaterial color="#e9e5da" roughness={0.8} />
      </mesh>
      {/* The two corner towers with their pyramid roofs. */}
      {[-27, 27].map((x) => (
        <group key={x} position={[x, 0, 1]}>
          <mesh position={[0, 12, 0]}>
            <boxGeometry args={[9, 24, 12]} />
            <meshStandardMaterial color="#924733" roughness={0.85} />
          </mesh>
          <mesh position={[0, 27, 0]} rotation-y={Math.PI / 4}>
            <coneGeometry args={[7.6, 6, 4]} />
            <meshStandardMaterial color="#4c5a52" roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0, 31, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 3, 6]} />
            <meshStandardMaterial color="#c9a447" metalness={0.6} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* Roof between the towers. */}
      <mesh position={[0, 19, -1]}>
        <boxGeometry args={[46, 2, 14]} />
        <meshStandardMaterial color="#4c5a52" roughness={0.7} />
      </mesh>
    </group>
  );
}

function MediaCentre({ night }: { night: boolean }) {
  const R = 108;
  const lift = 19;
  return (
    // Larger than life a little, so it reads behind the batter on the broadcast camera, as the real one does.
    <group position={[0, 0, R]} rotation-y={Math.PI} scale={1.45}>
      {/* The pod: smooth white aluminium, long and rounded. */}
      <mesh position={[0, lift + 5, 0]} rotation-z={Math.PI / 2} scale={[0.9, 1, 1.25]}>
        <capsuleGeometry args={[5.4, 30, 8, 24]} />
        <meshStandardMaterial color="#eef0f0" roughness={0.3} metalness={0.35} />
      </mesh>
      {/* The sloping band of glass across its front, towards the pitch. */}
      <mesh position={[0, lift + 5.6, 6.2]} rotation-x={-0.35}>
        <boxGeometry args={[34, 3.4, 0.4]} />
        <meshStandardMaterial color="#1e2a33" roughness={0.15} metalness={0.6} emissive="#9ec5ff" emissiveIntensity={night ? 0.5 : 0} />
      </mesh>
      {/* On two legs (the stair and lift towers). */}
      {[-11, 11].map((x) => (
        <mesh key={x} position={[x, (lift + 1) / 2, -0.5]}>
          <boxGeometry args={[3.4, lift + 1, 3.4]} />
          <meshStandardMaterial color="#d9dcdf" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Tented fabric canopies on masts, over the top of a stand (the Mound Stand). */
function Canopies({ at, r, y, count, span }: { at: number; r: number; y: number; count: number; span: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, k) => {
        const a = at - span / 2 + (k / (count - 1)) * span;
        return (
          <group key={k} position={[Math.sin(a) * r, y, Math.cos(a) * r]}>
            <mesh position={[0, 2.6, 0]}>
              <coneGeometry args={[6.4, 5, 16, 1, true]} />
              <meshStandardMaterial color="#f6f6f2" roughness={0.75} side={DoubleSide} />
            </mesh>
            <mesh position={[0, 3.2, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 7.5, 6]} />
              <meshStandardMaterial color="#c8ccd2" metalness={0.5} roughness={0.4} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** A crown of white fabric sails over the top of the stands, tilted in towards the field. */
function Sails({ r, y, count }: { r: number; y: number; count: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, k) => {
        const a = (k / count) * Math.PI * 2;
        return (
          <group key={k} position={[Math.sin(a) * r, y, Math.cos(a) * r]} rotation-y={a}>
            <mesh rotation-x={-0.55} position={[0, 4, 0]}>
              <coneGeometry args={[10.5, 8, 3, 1, true]} />
              <meshStandardMaterial color="#f4f4ef" roughness={0.7} side={DoubleSide} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Plane trees round the outside of the ground, above the low stands. */
function Trees() {
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const rng = new Rng('lords-trees');
    const out: { x: number; z: number; h: number; s: number }[] = [];
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2);
      // Not in front of the Pavilion or behind the Media Centre.
      if (Math.abs(Math.cos(a)) > 0.88) continue;
      const r = rng.range(112, 128);
      out.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, h: rng.range(9, 14), s: rng.range(5, 8) });
    }
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    spots.forEach((t, i) => {
      m.compose(new Vector3(t.x, t.h / 2, t.z), q, new Vector3(1, t.h, 1));
      trunks.current?.setMatrixAt(i, m);
      m.compose(new Vector3(t.x, t.h + t.s * 0.4, t.z), q, new Vector3(t.s, t.s * 0.85, t.s));
      crowns.current?.setMatrixAt(i, m);
    });
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) crowns.current.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, spots.length]}>
        <cylinderGeometry args={[0.35, 0.45, 1, 6]} />
        <meshStandardMaterial color="#6d5a45" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, spots.length]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#3f6b34" roughness={0.95} flatShading />
      </instancedMesh>
    </group>
  );
}
