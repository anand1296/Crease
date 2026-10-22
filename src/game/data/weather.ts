import type { PitchPreset } from './pitches.ts';

/**
 * Conditions. Each changes how the ball behaves and how the ground looks:
 * cloud helps the ball swing and seam; under lights the dew settles in the
 * second innings, so the ball skids on and spinners cannot grip it; heat and
 * humidity give some swing early and the pitch dries and turns.
 */
export type WeatherId = 'sunny' | 'overcast' | 'lights' | 'humid';

export interface Weather {
  readonly id: WeatherId;
  readonly name: string;
  readonly blurb: string;
  /** Multipliers on the pitch: swing in the air, seam and turn off the surface. */
  readonly swing: number;
  readonly seam: number;
  readonly grip: number;
  /** In the second innings (dew under lights): grip and skid. */
  readonly secondInnings?: { readonly grip: number; readonly friction: number };
  /** How it looks. */
  readonly look: {
    readonly night: boolean;
    /** Sun direction (or the main light at night) and its colour and strength. */
    readonly sun: readonly [number, number, number];
    readonly sunColor: string;
    readonly sunIntensity: number;
    readonly sky: { readonly turbidity: number; readonly rayleigh: number; readonly mie: number };
    readonly hemi: { readonly sky: string; readonly ground: string; readonly intensity: number };
    readonly fog: { readonly color: string; readonly near: number; readonly far: number };
    /** Cloud cover drawn over the sky, 0–1. */
    readonly cloud: number;
  };
}

export const WEATHER: Readonly<Record<WeatherId, Weather>> = {
  sunny: {
    id: 'sunny',
    name: 'Sunny',
    blurb: 'Clear and bright: not much swing, a true surface that dries and turns as the day goes on.',
    swing: 0.85,
    seam: 1,
    grip: 1.1,
    look: {
      night: false,
      sun: [42, 40, -34],
      sunColor: '#fff4e2',
      sunIntensity: 1,
      sky: { turbidity: 5, rayleigh: 1.1, mie: 0.004 },
      hemi: { sky: '#eaf3ff', ground: '#4a6b3c', intensity: 1 },
      fog: { color: '#c9dbe9', near: 180, far: 520 },
      cloud: 0.12,
    },
  },
  overcast: {
    id: 'overcast',
    name: 'Overcast',
    blurb: 'Heavy cloud: the ball swings and seams — a day for the quick bowlers.',
    swing: 1.35,
    seam: 1.15,
    grip: 0.95,
    look: {
      night: false,
      sun: [20, 60, -10],
      sunColor: '#e6ebf0',
      sunIntensity: 0.45,
      sky: { turbidity: 18, rayleigh: 2.6, mie: 0.02 },
      hemi: { sky: '#d5dbe2', ground: '#4d5e46', intensity: 1.45 },
      fog: { color: '#aeb6bf', near: 140, far: 420 },
      cloud: 0.92,
    },
  },
  lights: {
    id: 'lights',
    name: 'Under lights',
    blurb: 'A day/night game: a little swing under the lights early on; dew in the second innings makes the ball skid on and hard for spinners to grip.',
    swing: 1.1,
    seam: 1,
    grip: 1,
    secondInnings: { grip: 0.7, friction: 0.82 },
    look: {
      night: true,
      sun: [30, 70, -40],
      sunColor: '#f4f6ff',
      sunIntensity: 1.05,
      sky: { turbidity: 2, rayleigh: 0.2, mie: 0.002 },
      hemi: { sky: '#3a4a6a', ground: '#21361f', intensity: 0.8 },
      fog: { color: '#0b1220', near: 200, far: 600 },
      cloud: 0,
    },
  },
  humid: {
    id: 'humid',
    name: 'Hot and humid',
    blurb: 'Hazy and muggy: some swing with the new ball, and a surface that grips for the spinners.',
    swing: 1.15,
    seam: 0.95,
    grip: 1.2,
    look: {
      night: false,
      sun: [60, 28, -20],
      sunColor: '#ffe2b8',
      sunIntensity: 0.9,
      sky: { turbidity: 12, rayleigh: 1.6, mie: 0.012 },
      hemi: { sky: '#f0e6d2', ground: '#56653c', intensity: 1.05 },
      fog: { color: '#d8cdb8', near: 120, far: 420 },
      cloud: 0.35,
    },
  },
};

export const WEATHER_IDS = Object.keys(WEATHER) as WeatherId[];

/** The pitch as the conditions make it play, in this innings (0 = first). */
export function pitchInConditions(pitch: PitchPreset, weather: WeatherId, innings: number): PitchPreset {
  const w = WEATHER[weather];
  const dew = innings > 0 ? w.secondInnings : undefined;
  return {
    ...pitch,
    swingConditions: pitch.swingConditions * w.swing,
    surface: {
      ...pitch.surface,
      seam: pitch.surface.seam * w.seam,
      grip: pitch.surface.grip * w.grip * (dew?.grip ?? 1),
      friction: pitch.surface.friction * (dew?.friction ?? 1),
    },
  };
}
