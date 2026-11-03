import { BufferGeometry, CanvasTexture, Float32BufferAttribute, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * A modern cricket bat, built once and shared: a flat face, thick edges, a
 * pronounced spine down the back peaking low in the blade, sloping
 * shoulders, a rounded toe with a black toe guard, and a rubber grip on a
 * cane handle. Stickers in the game's own brand down the face and the back.
 *
 * Local frame: the top of the handle at the origin, the bat along −y, the
 * face towards +z (the back, with its spine, towards −z).
 */
export const BAT = {
  length: 0.86,
  handle: 0.28,
  width: 0.108,
  /** Edge thickness and spine depth at their fullest. */
  edge: 0.04,
  spine: 0.064,
} as const;

const BLADE = BAT.length - BAT.handle;
const ROWS = 28;
const SIDE = 9;

/** Depth of the back at `x` (−1 edge … 0 spine … 1 edge) and `v` (0 shoulder … 1 toe). */
function backDepth(x: number, v: number): number {
  // The spine peaks a little below the middle of the blade (the sweet spot), the edges stay thick to the toe.
  const peak = Math.exp(-(((v - 0.62) / 0.42) ** 2));
  const spine = 0.034 + (BAT.spine - 0.034) * peak;
  const edge = 0.028 + (BAT.edge - 0.028) * Math.min(1, v * 2.2);
  const k = Math.max(0, 1 - x * x);
  // Rounded into the shoulders at the top.
  const shoulder = Math.min(1, 0.35 + v / 0.09);
  return (edge + (spine - edge) * k ** 0.7) * shoulder;
}

/** Half-width of the blade at `v`: the shoulders slope in to the handle, the toe's corners are rounded. */
function halfWidth(v: number, x: number): number {
  const w = BAT.width / 2;
  const shoulder = v < 0.07 ? 0.55 + 0.45 * Math.sin((v / 0.07) * (Math.PI / 2)) : 1;
  const toe = v > 0.97 ? 1 - 0.18 * ((v - 0.97) / 0.03) ** 2 * Math.abs(x) : 1;
  return w * shoulder * toe;
}

let geometry: BufferGeometry | undefined;

/** The blade: face, back and edges lofted down its length, closed at the shoulders and the toe. */
export function bladeGeometry(): BufferGeometry {
  if (geometry) return geometry;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Each row: the face from one edge to the other (left → right), then the back from right → left.
  const ring = SIDE * 2;
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const y = -BAT.handle - v * BLADE;
    for (let i = 0; i < SIDE; i++) {
      const x = -1 + (2 * i) / (SIDE - 1);
      pos.push(x * halfWidth(v, x), y, 0.002 * (1 - x * x));
      // Face stickers on the left half of the texture.
      uv.push(0.5 * (i / (SIDE - 1)), 1 - v);
    }
    for (let i = 0; i < SIDE; i++) {
      const x = 1 - (2 * i) / (SIDE - 1);
      pos.push(x * halfWidth(v, x), y, -backDepth(x, v));
      uv.push(0.5 + 0.5 * (i / (SIDE - 1)), 1 - v);
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < ring; i++) {
      const a = r * ring + i;
      const b = r * ring + ((i + 1) % ring);
      const c = (r + 1) * ring + i;
      const d = (r + 1) * ring + ((i + 1) % ring);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Caps: fans from the centre of the first and last rows.
  for (const [r, flip] of [
    [0, true],
    [ROWS, false],
  ] as const) {
    const v = r / ROWS;
    const centre = pos.length / 3;
    pos.push(0, -BAT.handle - v * BLADE, -backDepth(0, v) / 2);
    uv.push(0.75, 0.5);
    for (let i = 0; i < ring; i++) {
      const a = r * ring + i;
      const b = r * ring + ((i + 1) % ring);
      if (flip) idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  geometry = g;
  return g;
}

let bladeMat: MeshStandardMaterial | undefined;
let gripMat: MeshStandardMaterial | undefined;

/** English willow with its grain, and the stickers: the face (left half of the texture) and the back (right half). */
export function bladeMaterial(): MeshStandardMaterial {
  if (bladeMat) return bladeMat;
  const W = 512;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = '#ead6a6';
    g.fillRect(0, 0, W, H);
    // Grain: fine straight lines down the blade, a little wavy, darker and lighter.
    for (let i = 0; i < 70; i++) {
      const x = (i / 70) * W + Math.sin(i * 12.9898) * 3;
      g.strokeStyle = i % 3 === 0 ? 'rgba(150,110,60,0.22)' : 'rgba(120,90,50,0.12)';
      g.lineWidth = i % 5 === 0 ? 1.6 : 0.8;
      g.beginPath();
      for (let y = 0; y <= H; y += 32) g.lineTo(x + Math.sin(y * 0.01 + i) * 1.5, y);
      g.stroke();
    }
    const sticker = (cx: number, big: boolean) => {
      // A band of colour near the shoulder, the name down the middle, a stripe near the toe.
      const w = big ? 200 : 170;
      g.fillStyle = '#0f2d5c';
      g.fillRect(cx - w / 2, 70, w, 46);
      g.fillStyle = '#d8a21c';
      g.fillRect(cx - w / 2, 116, w, 8);
      g.save();
      g.translate(cx, 560);
      g.rotate(-Math.PI / 2);
      g.font = `900 ${big ? 132 : 110}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 10;
      g.strokeStyle = '#0f2d5c';
      g.strokeText('CREASE', 0, 0);
      g.fillStyle = '#d8a21c';
      g.fillText('CREASE', 0, 0);
      g.restore();
      g.fillStyle = '#0f2d5c';
      g.fillRect(cx - w / 2, 900, w, 20);
      g.fillStyle = '#c0392b';
      g.fillRect(cx - w / 2, 920, w, 6);
    };
    sticker(W * 0.25, false);
    sticker(W * 0.75, true);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  bladeMat = new MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 });
  return bladeMat;
}

/** A rubber grip: a dark base with a raised chevron pattern, repeating up the handle. */
export function gripMaterial(): MeshStandardMaterial {
  if (gripMat) return gripMat;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  if (g) {
    g.fillStyle = '#1b1f2a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#b8212b';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 40);
    g.lineTo(32, 16);
    g.lineTo(64, 40);
    g.stroke();
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 9);
  gripMat = new MeshStandardMaterial({ map: tex, roughness: 0.95 });
  return gripMat;
}
