import { useEffect, useMemo } from 'react';
import { BackSide, CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { Rng } from '../core/rng.ts';

/**
 * Skies the physical sky model doesn't draw: night (a deep blue gradient
 * with stars, a faint glow above the stadium lights) and cloud cover (a
 * dome of procedural cloud, from scattered to a solid grey overcast).
 */

function nightTexture(): CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    // v runs from the top of the dome (0) to the horizon (h/2) and below.
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#02040b');
    grad.addColorStop(0.38, '#0a1226');
    grad.addColorStop(0.5, '#25304a');
    grad.addColorStop(0.56, '#141a28');
    grad.addColorStop(1, '#05070c');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rng = new Rng('stars');
    for (let i = 0; i < 700; i++) {
      const y = rng.range(0, h * 0.42);
      const a = rng.range(0.25, 0.9) * (1 - y / (h * 0.5));
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      const s = rng.chance(0.08) ? 2 : 1;
      g.fillRect(rng.range(0, w), y, s, s);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function NightSky() {
  const tex = useMemo(nightTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh>
      <sphereGeometry args={[700, 32, 16]} />
      <meshBasicMaterial map={tex} side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

/** Soft cloud: layered blobs, tiling round the dome. */
function cloudTexture(cover: number, night: boolean): CanvasTexture {
  const w = 1024;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    const rng = new Rng(`clouds-${cover}`);
    const shade = night ? '40,46,60' : cover > 0.8 ? '122,128,137' : '255,255,255';
    // A base layer for overcast skies.
    if (cover > 0.6) {
      g.fillStyle = `rgba(${shade},${Math.min(0.97, (cover - 0.3) * 1.6)})`;
      g.fillRect(0, 0, w, h);
    }
    const n = Math.round(60 + cover * 260);
    for (let i = 0; i < n; i++) {
      const x = rng.range(0, w);
      const y = rng.range(h * 0.05, h * 0.95);
      const r = rng.range(18, 60) * (0.6 + cover);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const lit = cover > 0.8 ? `${120 + rng.int(0, 45)},${126 + rng.int(0, 45)},${134 + rng.int(0, 45)}` : shade;
      grad.addColorStop(0, `rgba(${lit},${(0.35 + cover * 0.4).toFixed(2)})`);
      grad.addColorStop(1, `rgba(${lit},0)`);
      g.fillStyle = grad;
      // Wrap round so the dome has no seam.
      for (const dx of [0, -w, w]) {
        g.beginPath();
        g.ellipse(x + dx, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

export function CloudDome({ cover, night }: { cover: number; night: boolean }) {
  const tex = useMemo(() => cloudTexture(cover, night), [cover, night]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    // The upper part of a sphere well inside the sky, from the horizon up.
    <mesh>
      <sphereGeometry args={[560, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.47]} />
      <meshBasicMaterial map={tex} side={BackSide} transparent fog={false} depthWrite={false} />
    </mesh>
  );
}
