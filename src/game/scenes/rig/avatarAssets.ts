import type { ClipName } from './Humanoid.tsx';

/**
 * Player models: four Microsoft Rocketbox athletes (MIT licence), converted
 * by scripts/avatars/ into skinned glTF models with 1024² textures, a kit
 * mask for painting team colours, and a set of motion-captured clips.
 */
export const AVATARS = ['p1', 'p2', 'p3', 'p4'] as const;
export type AvatarId = (typeof AVATARS)[number];

const BASE = `${import.meta.env.BASE_URL}players/`;

export const avatarUrl = (id: AvatarId) => `${BASE}${id}.glb`;
/** Avatars whose hair is a separate, alpha-tested layer. */
const HAIR: readonly AvatarId[] = ['p3'];

/** Body, body normals, head, head normals, kit mask, and (some avatars) hair. */
export const textureUrls = (id: AvatarId) => [
  `${BASE}${id}_body.jpg`,
  `${BASE}${id}_body_n.jpg`,
  `${BASE}${id}_head.jpg`,
  `${BASE}${id}_head_n.jpg`,
  `${BASE}${id}_kit.png`,
  ...(HAIR.includes(id) ? [`${BASE}${id}_hair.png`] : []),
];

export interface ClipData {
  readonly duration: number;
  readonly frames: number;
  readonly loop: boolean;
  /** Natural ground speed of a locomotion clip, m/s (0 for others). */
  readonly speed: number;
  /** Root (pelvis) height per frame, metres. */
  readonly height: readonly number[];
  /** Local rotation (x, y, z, w per frame) per bone. */
  readonly tracks: Readonly<Record<string, readonly number[]>>;
}

export type Clips = Readonly<Record<ClipName, ClipData>>;

let clips: Promise<Clips> | undefined;

/** The clip library, fetched once. */
export function loadClips(): Promise<Clips> {
  clips ??= fetch(`${BASE}clips.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load player animations (${r.status})`);
    return r.json();
  });
  return clips;
}
