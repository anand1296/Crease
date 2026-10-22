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
}

export function preloadCricketers(): void {
  for (const id of AVATARS) {
    useLoader.preload(GLTFLoader, avatarUrl(id));
    useLoader.preload(TextureLoader, textureUrls(id));
  }
  void loadClips();
}

export const Cricketer = forwardRef<HumanoidHandle, CricketerProps>(function Cricketer({ kit, avatar, tone }, ref) {
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
    model.traverse((o) => {
      if (o instanceof SkinnedMesh) meshes.push(o);
    });
    if (meshes.length === 0) throw new Error('Player model has no skinned mesh');
    const kitMat = kitMaterial(body, bodyN, mask, kit, tone);
    const headMat = headMaterial(head, headN, tone);
    const hairMat = hair ? hairMaterial(hair, tone) : headMat;
    for (const mesh of meshes) {
      const names = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m: Material) => m.name);
      mesh.material = names.includes('head') ? headMat : names.includes('hair') ? hairMat : kitMat;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    model.updateMatrixWorld(true);
    addProps(model, kit);
    return { model, rig: new AvatarRig(model, clips), headwear: model.getObjectByName('headwear') };
  }, [gltf, textures, clips, kit, tone]);

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
        if (built.headwear && built.headwear.visible !== visible) built.headwear.visible = visible;
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

function headMaterial(map: Texture, normalMap: Texture, tone: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map, normalMap, roughness: 0.55, metalness: 0 });
  const tint = { value: toneColor(tone) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.skinTint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 skinTint;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= skinTint;');
  };
  m.customProgramCacheKey = () => 'crease-head-v1';
  return m;
}

// --- Equipment ------------------------------------------------------------------------------
// Built in model space (centimetres, bind pose) and parented to bones.

const geo = {
  helmet: new SphereGeometry(12.2, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6),
  peak: new BoxGeometry(17, 0.8, 7),
  bar: new TorusGeometry(10.5, 0.45, 5, 18, Math.PI * 0.9),
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
    const shell = mat(darken(kit.shirt, 0.55), 0.35, 0.15);
    const helmet = part(geo.helmet, shell, 0, 0, 0);
    helmet.scale.set(1, 0.98, 1.12);
    g.add(helmet);
    g.add(part(geo.peak, shell, 0, 1.2, 12.5, 0.28));
    const grille = mat('#8f969e', 0.35, 0.8);
    for (const [y, s] of [[-5.5, 1], [-9.5, 0.92], [-13, 0.8]] as const) {
      const bar = part(geo.bar, grille, 0, y, 2.5, Math.PI / 2, 0, Math.PI * 0.05);
      bar.scale.set(s, s, 1);
      bar.rotation.set(Math.PI / 2, 0, Math.PI * 1.05);
      g.add(bar);
    }
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
