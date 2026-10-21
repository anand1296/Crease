import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, Sky } from '@react-three/drei';
import { Effects } from './Effects.tsx';
import { Ground } from './Ground.tsx';
import { MatchView } from './MatchView.tsx';
import { Stadium } from './Stadium.tsx';
import { useGame } from '../../state/game.ts';
import { preloadCricketers } from './rig/Cricketer.tsx';

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

export function GameCanvas({ onReady }: { onReady: () => void }) {
  const quality = useGame((s) => s.quality);
  const high = quality === 'high';
  return (
    <Canvas
      key={quality}
      shadows={high ? 'soft' : false}
      dpr={high ? [1, 1.5] : 1}
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
      {high ? <Effects /> : null}
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}
