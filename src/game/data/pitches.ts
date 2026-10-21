import { DEFAULT_OUTFIELD, type GroundModel, type SurfaceProperties } from '../physics/ball.ts';

/**
 * Pitch presets. Each one is a set of physical multipliers rather than a
 * difficulty switch: a green pitch seams and bounces more for every bowler,
 * a dry one grips for spinners and keeps lower, and so on.
 */
export type PitchId = 'balanced' | 'green' | 'dry' | 'flat';

export interface PitchPreset {
  readonly id: PitchId;
  readonly name: string;
  readonly description: string;
  readonly surface: SurfaceProperties;
  /** Standard deviation of per-delivery bounce variation (uneven bounce). */
  readonly bounceVariability: number;
  /** How much the atmosphere helps swing, 0–1.5. */
  readonly swingConditions: number;
}

export const PITCHES: Readonly<Record<PitchId, PitchPreset>> = {
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'Even contest between bat and ball.',
    surface: { restitution: 0.55, bounceFriction: 0.12, rollingResistance: 1.6, grip: 1, seam: 1 },
    bounceVariability: 0.03,
    swingConditions: 1,
  },
  green: {
    id: 'green',
    name: 'Green top',
    description: 'Grass on the surface: extra seam movement and bounce for the quicks.',
    surface: { restitution: 0.6, bounceFriction: 0.1, rollingResistance: 1.7, grip: 0.7, seam: 1.6 },
    bounceVariability: 0.04,
    swingConditions: 1.25,
  },
  dry: {
    id: 'dry',
    name: 'Dry turner',
    description: 'Cracked and dusty: big turn, slower and lower bounce, some uneven bounce.',
    surface: { restitution: 0.5, bounceFriction: 0.16, rollingResistance: 1.5, grip: 1.6, seam: 0.7 },
    bounceVariability: 0.07,
    swingConditions: 0.8,
  },
  flat: {
    id: 'flat',
    name: 'Flat deck',
    description: 'Hard and true: little movement, ball comes on to the bat.',
    surface: { restitution: 0.57, bounceFriction: 0.09, rollingResistance: 1.6, grip: 0.7, seam: 0.6 },
    bounceVariability: 0.015,
    swingConditions: 0.7,
  },
};

export const groundFor = (pitch: PitchPreset): GroundModel => ({ pitch: pitch.surface, outfield: DEFAULT_OUTFIELD });
