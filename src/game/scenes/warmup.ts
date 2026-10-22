import { type Camera, type Material, type Object3D, type Scene, type Texture, type WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * Shader and texture warm-up.
 *
 * WebGL compiles a material's shader program the first time something using
 * it is drawn, and uploads a texture the first time it is sampled. Both block
 * the frame: on Windows (ANGLE → Direct3D) a single program can take a few
 * hundred milliseconds. Left alone, that happens mid-play — the first ball in
 * flight, the first broken wicket, the first replay — and the game freezes.
 *
 * So when a match is built, before it is shown:
 *  1. every texture in the scene is uploaded (`initTexture`);
 *  2. every material is compiled with `compileAsync`, which uses
 *     KHR_parallel_shader_compile where available, so the browser keeps
 *     painting the loading screen while the driver compiles;
 *  3. one full render (shadow map included) compiles what `compile` can't
 *     reach: the depth materials for shadows of skinned meshes.
 *
 * Hidden objects (the ball before release, batters waiting to come in,
 * flying bails) are made visible for the synchronous parts so their programs
 * are built too, then hidden again before anything is displayed.
 *
 * With post-processing the scene is drawn into an off-screen target, which
 * changes the program variant (linear output, no tone mapping), so the
 * warm-up renders into a small target as well; without it, to the canvas.
 */
const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'envMap'] as const;

function texturesOf(material: Material, out: Set<Texture>): void {
  const m = material as unknown as Record<string, unknown> & { uniforms?: Record<string, { value: unknown }> };
  for (const k of TEXTURE_KEYS) {
    const t = m[k] as Texture | null | undefined;
    if (t?.isTexture) out.add(t);
  }
  if (m.uniforms) {
    for (const u of Object.values(m.uniforms)) {
      const t = u?.value as Texture | null | undefined;
      if (t && typeof t === 'object' && t.isTexture) out.add(t);
    }
  }
}

function materialsOf(o: Object3D): Material[] {
  const m = (o as Object3D & { material?: Material | Material[] }).material;
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

/** Makes every hidden object visible, runs `fn`, and hides them again. */
function withEverythingVisible<T>(root: Object3D, fn: () => T): T {
  const hidden: Object3D[] = [];
  root.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    return fn();
  } finally {
    for (const o of hidden) o.visible = false;
  }
}

const uploaded = new WeakSet<Texture>();

export interface WarmUpOptions {
  /** Whether the frame is drawn through post-processing (an off-screen target). */
  readonly offscreen: boolean;
}

export async function warmUp(gl: WebGLRenderer, scene: Scene, camera: Camera, { offscreen }: WarmUpOptions): Promise<void> {
  const target = offscreen ? new WebGLRenderTarget(4, 4) : null;
  const previous = gl.getRenderTarget();
  try {
    // 1. Textures.
    const textures = new Set<Texture>();
    scene.traverse((o) => {
      for (const m of materialsOf(o)) texturesOf(m, textures);
    });
    for (const t of textures) {
      if (uploaded.has(t) || !t.image) continue;
      gl.initTexture(t);
      uploaded.add(t);
    }

    // 2. Programs, compiled in parallel where the browser supports it.
    gl.setRenderTarget(target);
    const ready = withEverythingVisible(scene, () => gl.compileAsync(scene, camera));
    gl.setRenderTarget(previous);
    await ready;

    // 3. One full frame (shadow depth materials and anything else left).
    withEverythingVisible(scene, () => {
      gl.setRenderTarget(target);
      gl.render(scene, camera);
    });
  } finally {
    gl.setRenderTarget(previous);
    target?.dispose();
  }
}
