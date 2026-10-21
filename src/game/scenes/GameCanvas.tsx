import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';
import { Ground } from './Ground.tsx';
import { MatchView } from './MatchView.tsx';
import { Stadium } from './Stadium.tsx';
import { Stumps } from './Stumps.tsx';
import { useGame } from '../../state/game.ts';

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
  const quality = useGame((s) => s.quality);
  const high = quality === 'high';
  return (
    <Canvas
      key={quality}
      shadows={high}
      dpr={high ? [1, 2] : 1}
      camera={{ fov: 10.5, near: 0.5, far: 900, position: [0, 9.5, -50.06] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <fog attach="fog" args={['#cfe2f0', 160, 420]} />
      <hemisphereLight args={['#eaf3ff', '#4a6b3c', 0.8]} />
      <directionalLight
        position={[30, 55, -20]}
        intensity={2}
        castShadow={high}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={35}
        shadow-camera-bottom={-35}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
      />
      <Ground />
      <Stadium crowd={high} />
      <Stumps z={STRIKER_STUMPS_Z} />
      <Stumps z={BOWLER_STUMPS_Z} />
      <MatchView />
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}
