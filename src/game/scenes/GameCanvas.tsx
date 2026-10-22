import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Sky } from '@react-three/drei';
import { Effects } from './Effects.tsx';
import { Ground } from './Ground.tsx';
import { MatchView } from './MatchView.tsx';
import { Stadium } from './Stadium.tsx';
import { useGame } from '../../state/game.ts';
import { preloadCricketers } from './rig/Cricketer.tsx';
import { FrameBudget } from './FrameBudget.tsx';
import { exposeDebug } from '../debug.ts';

// Start fetching the player models while the menus are up.
preloadCricketers();

/** Late-afternoon sun: long enough shadows to read the players' shapes. */
const SUN: [number, number, number] = [42, 40, -34];

/** Calls `onReady` once, after the first frame has actually been rendered. */
function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    onReady();
  });
  return null;
}

/**
 * Image-based lighting without image files: a small environment rendered
 * once from light panels (bright sky above, warm sun side, green bounce
 * from the grass below), so skin, kit and bat pick up believable fill and
 * reflections.
 */
function Lighting() {
  return (
    <Environment frames={1} resolution={128} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={1.6} color="#dcebff" position={[0, 60, 0]} rotation-x={Math.PI / 2} scale={[200, 200, 1]} />
      <Lightformer form="rect" intensity={1.2} color="#ffe9c7" position={[60, 25, -50]} scale={[60, 30, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={0.5} color="#5f8f45" position={[0, -10, 0]} rotation-x={-Math.PI / 2} scale={[200, 200, 1]} />
      <Lightformer form="ring" intensity={0.6} color="#c9d6e6" position={[-60, 20, 40]} scale={[40, 40, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}

/** Resolution scale at each adaptive level (see FrameBudget). */
const DPR_SCALE = [1, 0.85, 0.72, 0.6];

/**
 * Whether the 3D view needs drawing every frame. Behind the setup screens and
 * the pause menu nothing moves, so the canvas keeps its last frame and the
 * browser's main thread and GPU are free for the menus.
 */
function useLive(): boolean {
  return useGame((s) => s.screen === 'menu' || (s.screen === 'match' && (!s.paused || s.warming)));
}

/** Draws one more frame whenever the view stops being live, so it shows the latest state. */
function Invalidator({ live }: { live: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [live, invalidate]);
  return null;
}

/** Rendering statistics for tests and profiling. */
function RenderStats() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(
    () =>
      exposeDebug({
        renderInfo: () => {
          let objects = 0;
          scene.traverse(() => {
            objects++;
          });
          return {
            calls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            programs: gl.info.programs?.length ?? 0,
            textures: gl.info.memory.textures,
            geometries: gl.info.memory.geometries,
            objects,
            dpr: gl.getPixelRatio(),
            perf: useGame.getState().perf,
          };
        },
      }),
    [gl, scene],
  );
  return null;
}

export function GameCanvas({ onReady }: { onReady: () => void }) {
  const quality = useGame((s) => s.quality);
  const perf = useGame((s) => s.perf);
  const live = useLive();
  const high = quality === 'high';
  const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const dpr = (high ? Math.min(device, 1.5) : 1) * (DPR_SCALE[perf] ?? 1);
  return (
    <Canvas
      key={quality}
      frameloop={live ? 'always' : 'demand'}
      shadows={high ? 'soft' : false}
      dpr={dpr}
      onCreated={({ gl }) => {
        // Checking for shader errors reads compile logs synchronously, which
        // stalls on every new program; only worth it while developing.
        gl.debug.checkShaderErrors = import.meta.env.DEV;
      }}
      // With post-processing the tone mapping is done by the effect chain.
      flat={high}
      camera={{ fov: 15, near: 0.5, far: 900, position: [0, 12.5, -55] }}
      gl={{ antialias: !high, powerPreference: 'high-performance' }}
    >
      <fog attach="fog" args={['#c9dbe9', 180, 520]} />
      <Sky distance={600} sunPosition={SUN} turbidity={5} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.82} />
      {high ? <Lighting /> : null}
      <hemisphereLight args={['#eaf3ff', '#4a6b3c', high ? 0.45 : 0.85]} />
      <directionalLight
        position={SUN}
        intensity={high ? 2.6 : 2.1}
        color="#fff4e2"
        castShadow={high}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-38}
        shadow-camera-right={38}
        shadow-camera-top={38}
        shadow-camera-bottom={-38}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
      />
      <Ground />
      <Stadium crowd={high} />
      <MatchView />
      {high ? <Effects ao={perf < 2} /> : null}
      <FirstFrame onReady={onReady} />
      <FrameBudget live={live} />
      <Invalidator live={live} />
      <RenderStats />
    </Canvas>
  );
}
