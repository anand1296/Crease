import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { BROADCAST_CAMERA } from '../camera/presets.ts';
import { DemoBall } from './DemoBall.tsx';
import { Figures } from './Figures.tsx';
import { Ground } from './Ground.tsx';
import { Stumps } from './Stumps.tsx';

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

export function GameCanvas({ onReady, seed }: { onReady: () => void; seed: string }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: BROADCAST_CAMERA.fov, near: 0.1, far: 600, position: BROADCAST_CAMERA.position }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ camera }) => camera.lookAt(...BROADCAST_CAMERA.target)}
    >
      <color attach="background" args={['#9cc3e2']} />
      <fog attach="fog" args={['#b6d0e6', 120, 260]} />
      <hemisphereLight args={['#e6f1ff', '#47663a', 0.75]} />
      <directionalLight
        position={[25, 45, -15]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />
      <Ground />
      <Stumps z={STRIKER_STUMPS_Z} />
      <Stumps z={BOWLER_STUMPS_Z} />
      <Figures />
      <DemoBall seed={seed} />
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}
