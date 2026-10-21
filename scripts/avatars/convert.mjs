/**
 * Converts Microsoft Rocketbox avatars (MIT, https://github.com/microsoft/Microsoft-Rocketbox)
 * into the game's runtime assets:
 *
 *   public/players/<id>.glb      skinned mesh + skeleton (metres, no textures)
 *   public/players/clips.json    motion-capture clips, main bones only, compact
 *   <work>/<id>.uv.json          UV triangles with bind positions, for the kit mask (see mask.py)
 *
 * Usage: node scripts/avatars/convert.mjs <rocketbox-src-dir> <work-dir>
 * where <rocketbox-src-dir> holds <Avatar>/<Avatar>.fbx and the m_*.fbx clips.
 * This runs once, offline; the outputs are committed.
 */
import fs from 'node:fs';
import path from 'node:path';

// Minimal browser shims for three's loaders/exporters in Node.
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_v) {}, style: {} }),
  createElement: () => ({ getContext: () => null, style: {} }),
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
      this.onload?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
      this.onload?.();
    });
  }
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const THREE = await import(path.join(root, 'node_modules/three/build/three.module.js'));
const { FBXLoader } = await import(path.join(root, 'node_modules/three/examples/jsm/loaders/FBXLoader.js'));
const { GLTFExporter } = await import(path.join(root, 'node_modules/three/examples/jsm/exporters/GLTFExporter.js'));
const { mergeVertices } = await import(path.join(root, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'));

const [src, work] = process.argv.slice(2);
if (!src || !work) throw new Error('usage: convert.mjs <src> <work>');
const out = path.join(root, 'public/players');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(work, { recursive: true });

const AVATARS = [
  ['Sports_Male_01', 'p1'],
  ['Sports_Male_02', 'p2'],
  ['Sports_Male_03', 'p3'],
  ['Sports_Male_04', 'p4'],
];

/** Bones the game animates (no face, no fingers). */
const MAIN = [
  'Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head',
  'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand',
  'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
  'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_L_Toe0',
  'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot', 'Bip01_R_Toe0',
];

function load(file) {
  const buf = fs.readFileSync(file);
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

const round = (v, k) => Math.round(v * k) / k;

for (const [name, id] of AVATARS) {
  const obj = load(path.join(src, name, `${name}.fbx`));
  let mesh;
  obj.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });
  if (!mesh) throw new Error(`${name}: no skinned mesh`);
  // Plain materials named for their texture set; textures are loaded separately at runtime.
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
    const name = /head/i.test(m.name) ? 'head' : /opacity/i.test(m.name) ? 'hair' : 'body';
    return new THREE.MeshStandardMaterial({ name });
  });
  mesh.material = mats;
  // Index the triangle soup the FBX loader produces.
  const g = mesh.geometry;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
  const groups = g.groups.map((gr) => ({ ...gr }));
  // Merge per group so the material split survives.
  const parts = groups.map((gr) => {
    const sub = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) {
      sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize, a.normalized));
    }
    return { geo: mergeVertices(sub, 1e-4), material: gr.materialIndex };
  });
  // Re-assemble one indexed geometry with groups.
  const merged = new THREE.BufferGeometry();
  const attrs = {};
  let vertexOffset = 0;
  const index = [];
  const newGroups = [];
  for (const p of parts) {
    const start = index.length;
    const idx = p.geo.index.array;
    for (let i = 0; i < idx.length; i++) index.push(idx[i] + vertexOffset);
    newGroups.push({ start, count: idx.length, materialIndex: p.material });
    for (const [k, a] of Object.entries(p.geo.attributes)) (attrs[k] ??= { size: a.itemSize, data: [], normalized: a.normalized }).data.push(...a.array);
    vertexOffset += p.geo.attributes.position.count;
  }
  for (const [k, a] of Object.entries(attrs)) {
    const Arr = k === 'skinIndex' ? Uint16Array : Float32Array;
    merged.setAttribute(k, new THREE.BufferAttribute(new Arr(a.data), a.size, a.normalized));
  }
  merged.setIndex(index);
  // Collapse consecutive groups with the same material.
  const collapsed = [];
  for (const gr of newGroups) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.materialIndex === gr.materialIndex && last.start + last.count === gr.start) last.count += gr.count;
    else collapsed.push({ ...gr });
  }
  collapsed.forEach((gr) => merged.addGroup(gr.start, gr.count, gr.materialIndex));
  mesh.geometry = merged;
  mesh.name = 'body';

  // UV triangles of the body material with bind-pose positions, for the kit mask.
  obj.updateMatrixWorld(true);
  const pos = merged.attributes.position;
  const uv = merged.attributes.uv;
  const v = new THREE.Vector3();
  const bindPos = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    bindPos.push(round(v.x, 100), round(v.y, 100), round(v.z, 100));
  }
  const bones = {};
  const wp = new THREE.Vector3();
  for (const b of mesh.skeleton.bones) {
    if (!MAIN.includes(b.name)) continue;
    b.getWorldPosition(wp);
    bones[b.name] = [round(wp.x, 100), round(wp.y, 100), round(wp.z, 100)];
  }
  const tris = { body: [], head: [], hair: [] };
  for (const gr of collapsed) {
    const key = mats[gr.materialIndex].name;
    for (let i = gr.start; i < gr.start + gr.count; i++) tris[key].push(index[i]);
  }
  fs.writeFileSync(
    path.join(work, `${id}.uv.json`),
    JSON.stringify({ uv: Array.from(uv.array, (x) => round(x, 1e5)), pos: bindPos, tris, bones, materials: mats.map((m) => m.name) }),
  );

  obj.animations = [];
  for (const child of [...obj.children]) if (child !== mesh && !child.isBone && !child.children.some((c) => c.isBone)) obj.remove(child);
  const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: [] });
  fs.writeFileSync(path.join(out, `${id}.glb`), Buffer.from(glb));
  console.log(name, '→', id, 'verts', pos.count, 'tris', index.length / 3, 'glb', (glb.byteLength / 1024).toFixed(0), 'KiB');
}

// --- Clips ---------------------------------------------------------------------------
const CLIPS = {
  sprint: { file: 'm_run_fast_01', loop: true },
  run: { file: 'm_run_neutral', loop: true },
  jog: { file: 'm_run_slow_01', loop: true },
  walk: { file: 'm_walk_neutral', loop: true },
  idle: { file: 'm_idle_neutral_01', loop: true, from: 0, to: 8, fps: 15 },
  breathe: { file: 'm_idle_breathe_01', loop: true, fps: 15 },
  cheer: { file: 'm_cheer_01', loop: false, from: 0, to: 5, fps: 20 },
  cheer2: { file: 'm_cheer_02', loop: false, from: 0, to: 5, fps: 20 },
  clap: { file: 'm_claphands_01', loop: true, from: 0, to: 4, fps: 20 },
  crouch: { file: 'm_crouch_idle', loop: true, from: 0, to: 6, fps: 15 },
};
const clips = {};
for (const [key, spec] of Object.entries(CLIPS)) {
  const file = path.join(src, `${spec.file}.fbx`);
  if (!fs.existsSync(file)) {
    console.warn('missing', file);
    continue;
  }
  const a = load(file).animations[0];
  const from = spec.from ?? 0;
  const to = Math.min(a.duration, spec.to ?? a.duration);
  const fps = spec.fps ?? 30;
  const frames = Math.max(2, Math.round((to - from) * fps) + 1);
  const times = Array.from({ length: frames }, (_, i) => from + ((to - from) * i) / (frames - 1));
  // Natural ground speed of locomotion clips (root travel / duration), m/s.
  const rootPos = a.tracks.find((t) => t.name === 'Bip01.position');
  let speed = 0;
  if (rootPos) {
    const v = rootPos.values;
    const n = v.length / 3;
    speed = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) / 100 / a.duration;
  }
  const tracks = {};
  const q = new THREE.Quaternion();
  for (const bone of MAIN) {
    const tr = a.tracks.find((t) => t.name === `${bone}.quaternion`);
    if (!tr) continue;
    const interp = tr.createInterpolant();
    const vals = [];
    for (const t of times) {
      const r = interp.evaluate(t);
      q.set(r[0], r[1], r[2], r[3]).normalize();
      vals.push(round(q.x, 1e4), round(q.y, 1e4), round(q.z, 1e4), round(q.w, 1e4));
    }
    tracks[bone] = vals;
  }
  // Root height only (metres): the in-place bob of a run.
  let height = [];
  if (rootPos) {
    const interp = rootPos.createInterpolant();
    height = times.map((t) => round(interp.evaluate(t)[1] / 100, 1e4));
  }
  clips[key] = { duration: round(to - from, 1e4), frames, loop: spec.loop, speed: round(speed, 100), height, tracks };
  console.log('clip', key, (to - from).toFixed(2), 's', frames, 'frames', 'speed', speed.toFixed(2));
}
fs.writeFileSync(path.join(out, 'clips.json'), JSON.stringify(clips));
console.log('clips.json', (fs.statSync(path.join(out, 'clips.json')).size / 1024).toFixed(0), 'KiB');
