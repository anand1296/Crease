import { forwardRef, use, useImperativeHandle, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  type Object3D,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusGeometry,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type AvatarId, AVATARS, avatarUrl, loadClips, textureUrls } from './avatarAssets.ts';
import { AvatarRig } from './avatarRig.ts';
import { Humanoid, type HumanoidHandle, type Kit, type Pose, type RigHandle, newRigFrames } from './Humanoid.tsx';

/**
 * A cricketer drawn with a skinned, motion-captured human model, wearing
 * the team's kit (painted through the avatar's kit mask), with helmet or
 * cap, pads and gloves as the role needs. Posed through the same `apply`
 * handle as the primitive rig, which it uses (hidden) as its control rig.
 */
export interface CricketerProps {
  readonly kit: Kit;
  readonly avatar: AvatarId;
  /** Skin and hair tone multiplier, 0 (as modelled) … 1 (much darker). */
  readonly tone: number;
  /** Facial hair. */
  readonly grooming?: Grooming;
}

/** Facial hair, drawn on the face: none, a few days' stubble, a moustache, or a full beard. */
export type Grooming = 'clean' | 'stubble' | 'moustache' | 'beard';

export function preloadCricketers(): void {
  for (const id of AVATARS) {
    useLoader.preload(GLTFLoader, avatarUrl(id));
    useLoader.preload(TextureLoader, textureUrls(id));
  }
  void loadClips();
}

export const Cricketer = forwardRef<HumanoidHandle, CricketerProps>(function Cricketer({ kit, avatar, tone, grooming = 'clean' }, ref) {
  const gltf = useLoader(GLTFLoader, avatarUrl(avatar));
  const textures = useLoader(TextureLoader, textureUrls(avatar));
  const clips = use(loadClips());
  const driver = useRef<RigHandle>(null);

  const built = useMemo(() => {
    const model = cloneSkinned(gltf.scene);
    const [body, bodyN, head, headN, mask, hair] = textures;
    if (!body || !bodyN || !head || !headN || !mask) throw new Error('Player textures missing');
    prepareTextures(body, bodyN, head, headN, mask);
    // glTF splits a multi-material mesh into one skinned mesh per material.
    const meshes: SkinnedMesh[] = [];
    const headMeshes: SkinnedMesh[] = [];
    model.traverse((o) => {
      if (o instanceof SkinnedMesh) meshes.push(o);
    });
    if (meshes.length === 0) throw new Error('Player model has no skinned mesh');
    const kitMat = kitMaterial(body, bodyN, mask, kit, tone);
    const headMat = headMaterial(head, headN, tone, grooming);
    const hairMat = hair ? hairMaterial(hair, tone) : headMat;
    for (const mesh of meshes) {
      const names = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m: Material) => m.name);
      mesh.material = names.includes('head') ? headMat : names.includes('hair') ? hairMat : kitMat;
      if (names.includes('head') || names.includes('hair')) headMeshes.push(mesh);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    model.updateMatrixWorld(true);
    const faceMesh = meshes.find((m) => m.material === headMat);
    if (faceMesh) placeFacialHair(headMat, faceMesh);
    addProps(model, kit);
    // Hair (and the top of the head) tucked under the cap, helmet or hat; the original is kept for when it comes off.
    const fitted = headMeshes.map((mesh) => ({ mesh, bare: mesh.geometry, covered: fitUnderHeadwear(model, mesh, kit, hairMat !== headMat && mesh.material === hairMat) }));
    for (const f of fitted) f.mesh.geometry = f.covered;
    return { model, rig: new AvatarRig(model, clips), headwear: model.getObjectByName('headwear'), fitted };
  }, [gltf, textures, clips, kit, tone, grooming]);

  const frames = useMemo(newRigFrames, []);
  const handle = useMemo<HumanoidHandle>(
    () => ({
      get root() {
        return driver.current?.root ?? null;
      },
      apply(p: Pose) {
        const d = driver.current;
        const r = d?.root;
        if (!d || !r) return;
        d.apply(p);
        d.frames(frames);
        built.rig.update(p, frames, r);
      },
      handWorld(side, out) {
        const r = driver.current?.root;
        if (!r) return out.set(0, 0, 0);
        built.rig.hand(side, out);
        return r.localToWorld(out);
      },
      gripWorld(side, out) {
        const r = driver.current?.root;
        if (!r) return out.set(0, 0, 0);
        built.rig.palm(side, out);
        return r.localToWorld(out);
      },
      headwear(visible: boolean) {
        if (!built.headwear || built.headwear.visible === visible) return;
        built.headwear.visible = visible;
        for (const f of built.fitted) f.mesh.geometry = visible ? f.covered : f.bare;
      },
    }),
    [built, frames],
  );
  useImperativeHandle(ref, () => handle, [handle]);

  return (
    <Humanoid ref={driver} kit={kit} hidden>
      <group scale={0.01}>
        <primitive object={built.model} />
      </group>
    </Humanoid>
  );
});

// --- Materials -----------------------------------------------------------------------------

const prepared = new WeakSet<Texture>();
function prepareTextures(body: Texture, bodyN: Texture, head: Texture, headN: Texture, mask: Texture): void {
  if (prepared.has(body)) return;
  body.colorSpace = SRGBColorSpace;
  head.colorSpace = SRGBColorSpace;
  bodyN.colorSpace = NoColorSpace;
  headN.colorSpace = NoColorSpace;
  mask.colorSpace = NoColorSpace;
  for (const t of [body, bodyN, head, headN, mask]) {
    t.anisotropy = 4;
    t.needsUpdate = true;
    prepared.add(t);
  }
}

/** Skin and hair darkening, as a linear-space multiplier. */
function toneColor(tone: number): Color {
  const k = Math.min(1, Math.max(0, tone));
  return new Color(1 - 0.5 * k, 1 - 0.58 * k, 1 - 0.62 * k);
}

function kitMaterial(map: Texture, normalMap: Texture, mask: Texture, kit: Kit, tone: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map, normalMap, roughness: 0.62, metalness: 0 });
  // A touch more relief from the normal map: arms, folds in the shirt.
  m.normalScale.set(1.25, 1.25);
  const gloves = kit.gloves === 'batting' ? '#f3f1ea' : kit.gloves === 'keeping' ? '#e6dcc3' : '#000000';
  const uniforms = {
    kitMap: { value: mask },
    shirtColor: { value: new Color(kit.shirt) },
    trimColor: { value: new Color(kit.trim) },
    trouserColor: { value: new Color(kit.trousers) },
    shoeColor: { value: new Color('#ecebe6') },
    gloveColor: { value: new Color(gloves) },
    gloveOn: { value: kit.gloves === 'none' ? 0 : 1 },
    skinTint: { value: toneColor(tone) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D kitMap;
uniform vec3 shirtColor;
uniform vec3 trimColor;
uniform vec3 trouserColor;
uniform vec3 shoeColor;
uniform vec3 gloveColor;
uniform float gloveOn;
uniform vec3 skinTint;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec4 kitM = texture2D(kitMap, vMapUv);
float shirtM = smoothstep(0.62, 0.9, kitM.r);
float trimM = smoothstep(0.2, 0.42, kitM.r) * (1.0 - shirtM);
float trouserM = smoothstep(0.4, 0.7, kitM.g);
float shoeM = smoothstep(0.4, 0.7, kitM.b);
float gloveM = smoothstep(0.4, 0.7, kitM.a) * gloveOn;
float kitAny = clamp(shirtM + trimM + trouserM + shoeM + gloveM, 0.0, 1.0);
diffuseColor.rgb *= mix(skinTint, vec3(1.0), kitAny);
diffuseColor.rgb = mix(diffuseColor.rgb, shirtColor, shirtM);
diffuseColor.rgb = mix(diffuseColor.rgb, trimColor, trimM);
diffuseColor.rgb = mix(diffuseColor.rgb, trouserColor, trouserM);
diffuseColor.rgb = mix(diffuseColor.rgb, shoeColor, shoeM);
diffuseColor.rgb = mix(diffuseColor.rgb, gloveColor, gloveM);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.86, kitAny);`,
      );
  };
  m.customProgramCacheKey = () => 'crease-kit-v1';
  return m;
}

function hairMaterial(map: Texture, tone: number): MeshStandardMaterial {
  map.colorSpace = SRGBColorSpace;
  const m = new MeshStandardMaterial({ map, roughness: 0.7, metalness: 0, alphaTest: 0.45, side: DoubleSide });
  m.color.copy(toneColor(tone));
  return m;
}

const GROOMING: Record<Grooming, { beard: number; moustache: number; stubble: number }> = {
  clean: { beard: 0, moustache: 0, stubble: 0 },
  stubble: { beard: 0.32, moustache: 0.3, stubble: 1 },
  moustache: { beard: 0.12, moustache: 0.85, stubble: 0.6 },
  beard: { beard: 0.8, moustache: 0.8, stubble: 0.5 },
};

/**
 * Skin: a little sheen (skin is not matt), the model's normal map a touch
 * stronger for definition in the face, and facial hair drawn on in the
 * shader from the face's own shape — measured from the nose tip, so it fits
 * every model without touching its textures.
 */
function headMaterial(map: Texture, normalMap: Texture, tone: number, grooming: Grooming): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({ map, normalMap, roughness: 0.52, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new Color('#e8b8a0') });
  m.normalScale.set(1.35, 1.35);
  const g = GROOMING[grooming];
  const uniforms = {
    skinTint: { value: toneColor(tone) },
    nose: { value: new Vector3() },
    upDir: { value: new Vector3(0, 1, 0) },
    fwdDir: { value: new Vector3(0, 0, 1) },
    sideDir: { value: new Vector3(1, 0, 0) },
    // Mesh units per centimetre.
    unit: { value: 1 },
    beard: { value: new Vector3(g.beard, g.moustache, g.stubble) },
  };
  m.userData.face = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 skinTint;
uniform vec3 nose;
uniform vec3 upDir;
uniform vec3 fwdDir;
uniform vec3 sideDir;
uniform float unit;
uniform vec3 beard;
varying vec3 vBind;
float hairHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb *= skinTint;
{
  // Centimetres from the tip of the nose: up, forward (out of the face), and across.
  vec3 d = (vBind - nose) / unit;
  float up = dot(d, upDir);
  float fwd = dot(d, fwdDir);
  float x = abs(dot(d, sideDir));
  // The jaw and chin: below the nose, on the front and sides of the face, thinning towards the ears.
  float jaw = smoothstep(-11.0, -8.0, up) * (1.0 - smoothstep(-2.6, -1.2, up)) * smoothstep(-13.0, -9.0, fwd) * (1.0 - smoothstep(7.0, 8.6, x));
  // Cheeks above the jaw line, lighter.
  float cheek = smoothstep(-5.5, -3.5, up) * (1.0 - smoothstep(-1.0, 1.0, up)) * smoothstep(3.0, 5.0, x) * (1.0 - smoothstep(7.0, 8.4, x)) * smoothstep(-11.0, -8.0, fwd);
  // The upper lip.
  float lip = smoothstep(-3.0, -2.4, up) * (1.0 - smoothstep(-1.3, -0.7, up)) * (1.0 - smoothstep(2.6, 3.6, x)) * smoothstep(-3.0, -1.5, fwd);
  // Keep the lips themselves clear.
  float mouth = smoothstep(-4.2, -3.6, up) * (1.0 - smoothstep(-3.0, -2.6, up)) * (1.0 - smoothstep(2.0, 2.8, x)) * smoothstep(-2.6, -1.2, fwd);
  float grain = 0.55 + 0.45 * hairHash(floor(vBind / unit * 6.0));
  float amount = max(beard.x * max(jaw, cheek * 0.6), beard.y * lip) * (1.0 - mouth);
  amount *= mix(1.0, grain, beard.z);
  vec3 hairColour = vec3(0.075, 0.055, 0.045) * skinTint;
  diffuseColor.rgb = mix(diffuseColor.rgb, hairColour, clamp(amount, 0.0, 0.92));
}`,
      );
  };
  m.customProgramCacheKey = () => 'crease-head-v2';
  return m;
}

/** Measures the face of this model (its nose tip, in the head mesh's own space) for the facial-hair shader. */
function placeFacialHair(material: MeshPhysicalMaterial, mesh: SkinnedMesh): void {
  const u = material.userData.face as { nose: { value: Vector3 }; upDir: { value: Vector3 }; fwdDir: { value: Vector3 }; sideDir: { value: Vector3 }; unit: { value: number } } | undefined;
  if (!u) return;
  const pos = mesh.geometry.getAttribute('position');
  const toModel = mesh.matrixWorld;
  const toMesh = new Matrix4().copy(toModel).invert();
  const v = new Vector3();
  let best = -Infinity;
  const tip = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    if (v.z > best) {
      best = v.z;
      tip.copy(v);
    }
  }
  const origin = tip.clone().applyMatrix4(toMesh);
  const axis = (dx: number, dy: number, dz: number) => tip.clone().add(new Vector3(dx, dy, dz)).applyMatrix4(toMesh).sub(origin);
  // Model space is centimetres; the mesh may be scaled.
  const up = axis(0, 1, 0);
  u.unit.value = up.length();
  u.nose.value.copy(origin);
  u.upDir.value.copy(up.normalize());
  u.fwdDir.value.copy(axis(0, 0, 1).normalize());
  u.sideDir.value.copy(axis(1, 0, 0).normalize());
}

// --- Equipment ------------------------------------------------------------------------------
// Built in model space (centimetres, bind pose) and parented to bones.

const geo = {
  helmet: new SphereGeometry(12.2, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6),
  peak: new BoxGeometry(17, 0.8, 7),
  // The helmet: shell skirt down over the ears and the back of the neck, a sloping peak, a steel grille.
  skirt: new CylinderGeometry(12.0, 11.3, 10, 22, 1, true, (50 * Math.PI) / 180, (260 * Math.PI) / 180),
  visor: new CylinderGeometry(12.5, 17.2, 3.2, 20, 1, true, (-58 * Math.PI) / 180, (116 * Math.PI) / 180),
  grilleTop: new TorusGeometry(13.4, 0.42, 6, 26, (124 * Math.PI) / 180),
  grilleMid: new TorusGeometry(12.6, 0.42, 6, 26, (112 * Math.PI) / 180),
  grilleChin: new TorusGeometry(9.8, 0.42, 6, 20, (84 * Math.PI) / 180),
  rod: new CylinderGeometry(0.38, 0.38, 1, 6),
  badge: new BoxGeometry(4.2, 3.4, 0.7),
  stem: new CapsuleGeometry(1.2, 3.2, 3, 8),
  cap: new SphereGeometry(10.8, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
  brim: new BoxGeometry(16, 0.6, 8),
  hatCrown: new CylinderGeometry(9.5, 10.5, 8, 18),
  hatBrim: new CylinderGeometry(18, 18, 0.6, 24),
  cane: new CapsuleGeometry(2.1, 44, 4, 8),
  kneeRoll: new CapsuleGeometry(3, 11, 4, 8),
  wing: new BoxGeometry(1.4, 26, 7),
  mitt: new CapsuleGeometry(5.2, 9, 4, 10),
};

const matCache = new Map<string, MeshStandardMaterial>();

/** A double-sided material (open shells: the helmet's skirt and peak). */
function sided(color: string, roughness: number): MeshStandardMaterial {
  const key = `${color}/${roughness}/double`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness: 0.08, side: DoubleSide });
    matCache.set(key, m);
  }
  return m;
}
function mat(color: string, roughness = 0.7, metalness = 0): MeshStandardMaterial {
  const key = `${color}/${roughness}/${metalness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness });
    matCache.set(key, m);
  }
  return m;
}

function darken(hex: string, k: number): string {
  return `#${new Color(hex).multiplyScalar(k).getHexString()}`;
}

/** Parents `obj` to `bone` so that, in the bind pose, it sits at `pos`/`quat` in model space. */
/**
 * The space each kind of headwear occupies on the head, in the model's own
 * units (cm, bind pose): an ellipsoid (cap, helmet) or a cylinder (hat),
 * above a cut-off height. Matches the props built in addProps.
 */
function headwearVolume(model: Object3D, kit: Kit): { centre: Vector3; radii: Vector3; above: number; shape: 'ellipsoid' | 'cylinder' } {
  const head = bonePos(model, 'Bip01_Head');
  if (kit.headwear === 'helmet') {
    const centre = new Vector3(head.x, head.y + 11, head.z + 0.5);
    const radii = new Vector3(12.2, 12.2 * 0.98, 12.2 * 1.12);
    return { centre, radii, above: centre.y - radii.y * 0.3, shape: 'ellipsoid' };
  }
  if (kit.headwear === 'cap') {
    const centre = new Vector3(head.x, head.y + 12.4, head.z + 0.4);
    return { centre, radii: new Vector3(10.8, 10.8 * 0.85, 10.8 * 1.08), above: centre.y - 0.6, shape: 'ellipsoid' };
  }
  const centre = new Vector3(head.x, head.y + 13.5, head.z + 0.5);
  return { centre, radii: new Vector3(9.5, 8, 9.5), above: centre.y - 0.4, shape: 'cylinder' };
}

/**
 * A copy of a head or hair mesh with every vertex that would show through
 * the headwear pulled just inside it (along the line from its centre), so
 * the hair is under the cap rather than poking out of its crown. Vertices
 * already inside, and those below the headwear's rim, are untouched.
 */
function fitUnderHeadwear(model: Object3D, mesh: SkinnedMesh, kit: Kit, hair = false): SkinnedMesh['geometry'] {
  const geometry = mesh.geometry.clone();
  const pos = geometry.getAttribute('position');
  const { centre, radii, above, shape } = headwearVolume(model, kit);
  const toModel = mesh.matrixWorld;
  const toMesh = new Matrix4().copy(toModel).invert();
  const v = new Vector3();
  const inside = 0.93;
  let moved = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    if (v.y < above) {
      // Long hair (locks, a bun) below the rim would stick out sideways from under it: let it hang
      // straight down, inside the headwear's footprint, as it does under a real cap or helmet.
      if (!hair) continue;
      const dx = v.x - centre.x;
      const dz = v.z - centre.z;
      const r = Math.hypot(dx / radii.x, dz / radii.z);
      const limit = 0.97;
      if (r <= limit) continue;
      const f = limit / r;
      v.set(centre.x + dx * f, v.y, centre.z + dz * f);
      v.applyMatrix4(toMesh);
      pos.setXYZ(i, v.x, v.y, v.z);
      moved++;
      continue;
    }
    const d = v.clone().sub(centre);
    if (shape === 'ellipsoid') {
      const k = Math.hypot(d.x / radii.x, Math.max(0, d.y) / radii.y, d.z / radii.z);
      if (k <= inside) continue;
      // Below the centre only the sides matter (the rim); above it, the whole dome.
      const f = inside / k;
      v.set(centre.x + d.x * f, d.y > 0 ? centre.y + d.y * f : v.y, centre.z + d.z * f);
    } else {
      const r = Math.hypot(d.x / radii.x, d.z / radii.z);
      const top = radii.y * inside;
      if (r <= inside && d.y <= top) continue;
      const f = r > inside ? inside / r : 1;
      v.set(centre.x + d.x * f, Math.min(v.y, centre.y + top), centre.z + d.z * f);
    }
    v.applyMatrix4(toMesh);
    pos.setXYZ(i, v.x, v.y, v.z);
    moved++;
  }
  // The original normals are kept: recomputing them would crease the UV seams.
  if (moved > 0) pos.needsUpdate = true;
  return geometry;
}

function attach(model: Object3D, boneName: string, obj: Object3D, pos: Vector3, quat = new Quaternion()): void {
  const bone = model.getObjectByName(boneName);
  if (!bone) return;
  const desired = new Matrix4().compose(pos, quat, new Vector3(1, 1, 1));
  const local = new Matrix4().copy(bone.matrixWorld).invert().multiply(desired);
  local.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

function part(geometry: BoxGeometry | SphereGeometry | CapsuleGeometry | CylinderGeometry | TorusGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

function bonePos(model: Object3D, name: string): Vector3 {
  const b = model.getObjectByName(name);
  return b ? new Vector3().setFromMatrixPosition(b.matrixWorld) : new Vector3();
}

function addProps(model: Object3D, kit: Kit): void {
  const head = bonePos(model, 'Bip01_Head');
  if (kit.headwear === 'helmet') {
    const g = new Group();
    // A deep shade of the team colour, glossy like a painted shell.
    const shellColor = darken(kit.shirt, 0.36);
    const shell = mat(shellColor, 0.28, 0.1);
    const shellInside = sided(shellColor, 0.6);
    const helmet = part(geo.helmet, shell, 0, 0, 0);
    helmet.scale.set(1, 0.98, 1.12);
    g.add(helmet);
    // Down over the ears and the back of the head; open at the face.
    const skirt = part(geo.skirt, shellInside, 0, -4.6, 0);
    skirt.scale.set(1, 1, 1.12);
    g.add(skirt);
    // The peak slopes down over the eyes.
    const visor = part(geo.visor, shellInside, 0, 0.2, 0);
    visor.scale.set(1, 1, 1.12);
    g.add(visor);
    // A small crest on the front.
    g.add(part(geo.badge, mat(kit.trim, 0.5), 0, 6.2, 13.4, -0.42));
    // The grille: two crossbars round the face, a chin bar, and uprights tying them together.
    const steel = mat('#aeb4ba', 0.3, 0.55);
    const ring = (geometry: TorusGeometry, y: number, arc: number) => {
      const holder = new Group();
      const bar = part(geometry, steel);
      bar.rotation.x = Math.PI / 2;
      holder.add(bar);
      // Centre the arc on the front (+z).
      holder.rotation.y = arc / 2 - Math.PI / 2;
      holder.position.y = y;
      holder.scale.set(1, 1, 1.08);
      g.add(holder);
    };
    ring(geo.grilleTop, -4.8, (124 * Math.PI) / 180);
    ring(geo.grilleMid, -10.6, (112 * Math.PI) / 180);
    ring(geo.grilleChin, -15.2, (84 * Math.PI) / 180);
    const onRing = (r: number, deg: number, y: number) => new Vector3(r * Math.sin((deg * Math.PI) / 180), y, r * Math.cos((deg * Math.PI) / 180) * 1.08);
    const rod = (from: Vector3, to: Vector3) => {
      const m = part(geo.rod, steel);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.scale.set(1, from.distanceTo(to), 1);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), to.clone().sub(from).normalize());
      g.add(m);
    };
    for (const deg of [-24, 0, 24]) {
      rod(onRing(13.4, deg, -4.8), onRing(12.6, deg, -10.6));
      rod(onRing(12.6, deg, -10.6), onRing(9.8, deg * 0.8, -15.2));
    }
    // The grille is bolted to the shell at the sides.
    for (const sgn of [-1, 1]) {
      rod(onRing(13.4, 62 * sgn, -4.8), onRing(11.9, 68 * sgn, -8.6));
      rod(onRing(12.6, 56 * sgn, -10.6), onRing(11.6, 66 * sgn, -9.4));
      rod(onRing(9.8, 42 * sgn, -15.2), onRing(11.4, 64 * sgn, -9.8));
    }
    // Stem guard at the back of the neck.
    const stem = mat('#1d1f23', 0.8);
    for (const sgn of [-1, 1]) g.add(part(geo.stem, stem, sgn * 2.6, -15.6, -9.2, -0.35, 0, 0));
    attach(model, 'Bip01_Head', g, new Vector3(head.x, head.y + 11, head.z + 0.5));
  } else if (kit.headwear === 'cap') {
    const g = new Group();
    const cloth = mat(darken(kit.shirt, 0.75), 0.85);
    const crown = part(geo.cap, cloth);
    crown.scale.set(1, 0.85, 1.08);
    g.add(crown);
    g.add(part(geo.brim, cloth, 0, 0.4, 13, 0.12));
    g.name = 'headwear';
    attach(model, 'Bip01_Head', g, new Vector3(head.x, head.y + 12.4, head.z + 0.4));
  } else {
    const g = new Group();
    const cloth = mat('#f1ede0', 0.9);
    g.add(part(geo.hatCrown, cloth, 0, 4, 0));
    g.add(part(geo.hatBrim, cloth, 0, 0, 0));
    g.name = 'headwear';
    attach(model, 'Bip01_Head', g, new Vector3(head.x, head.y + 13.5, head.z + 0.5));
  }

  if (kit.pads) {
    const pad = mat('#f4f1e8', 0.75);
    for (const s of ['L', 'R'] as const) {
      const knee = bonePos(model, `Bip01_${s}_Calf`);
      const ankle = bonePos(model, `Bip01_${s}_Foot`);
      const g = new Group();
      // Vertical canes curving round the shin, a knee roll and side wings.
      for (const x of [-5.4, -1.8, 1.8, 5.4]) g.add(part(geo.cane, pad, x, 0, 7.2 - 0.07 * x * x));
      g.add(part(geo.kneeRoll, pad, 0, 15, 8.5, 0, 0, Math.PI / 2));
      g.add(part(geo.wing, pad, 7.6, -6, 4));
      g.add(part(geo.wing, pad, -7.6, -6, 4));
      const mid = new Vector3((knee.x + ankle.x) / 2, (knee.y + ankle.y) / 2 + 9, (knee.z + ankle.z) / 2);
      attach(model, `Bip01_${s}_Calf`, g, mid);
    }
  }

  if (kit.gloves === 'keeping') {
    const leather = mat('#e2d8bf', 0.6);
    for (const s of ['L', 'R'] as const) {
      const fore = bonePos(model, `Bip01_${s}_Forearm`);
      const hand = bonePos(model, `Bip01_${s}_Hand`);
      const dir = hand.clone().sub(fore).normalize();
      const centre = hand.clone().addScaledVector(dir, 7);
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
      const mitt = part(geo.mitt, leather);
      mitt.scale.set(1.15, 1, 0.6);
      attach(model, `Bip01_${s}_Hand`, mitt, centre, q);
    }
  }
}
