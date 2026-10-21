import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { Ground } from './Ground.tsx';
import { SessionView } from './SessionView.tsx';
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

export function GameCanvas({ onReady }: { onReady: () => void }) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 17, near: 0.1, far: 600, position: [0, 6.2, -26.1] }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
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
      <SessionView />
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}
