import { Bloom, EffectComposer, HueSaturation, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';

/**
 * Post-processing for High graphics: screen-space ambient occlusion (N8AO)
 * to ground players, stands and boards; a soft bloom on the floodlights and
 * sunlit whites; filmic tone mapping; a touch of saturation and a lens
 * vignette for a television look. Anti-aliased with 4× MSAA.
 */
export function Effects() {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <N8AO aoRadius={0.9} intensity={2.2} distanceFalloff={0.5} quality="medium" halfRes />
      <Bloom mipmapBlur intensity={0.35} luminanceThreshold={0.92} luminanceSmoothing={0.15} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <HueSaturation saturation={0.08} />
      <Vignette offset={0.32} darkness={0.42} />
    </EffectComposer>
  );
}
