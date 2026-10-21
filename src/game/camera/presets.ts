import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from '../data/field.ts';

export interface CameraPreset {
  readonly id: string;
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  readonly fov: number;
}

/** Classic broadcast view: raised, behind the bowler, looking at the striker. */
export const BROADCAST_CAMERA: CameraPreset = {
  id: 'broadcast',
  position: [0, 4.2, BOWLER_STUMPS_Z - 16],
  target: [0, 0.4, STRIKER_STUMPS_Z],
  fov: 32,
};
