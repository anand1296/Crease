/**
 * Grounds. Each is drawn procedurally from this description: the shape and
 * colours of its stands, its roof and its lights, and the landmarks that make
 * it recognisable on television. They are impressions of the real grounds,
 * not survey models. The playing area (boundary, pitch) is the same at all of
 * them.
 */
export type VenueId = 'crease' | 'lords' | 'mcg' | 'eden' | 'wankhede';

export interface Tier {
  /** Radius of the front row, metres from the centre of the pitch. */
  readonly r: number;
  /** Height of the front row. */
  readonly y: number;
  readonly rows: number;
  /** Seat colours, in blocks round the ground. */
  readonly seats: readonly string[];
  /** Part of the circle the tier covers (radians), centred on `facing` (0 = behind the striker's end). */
  readonly arc?: number;
  readonly facing?: number;
}

export type Landmark = 'pavilion' | 'mediaCentre' | 'moundCanopies' | 'trees' | 'sails';

export interface Venue {
  readonly id: VenueId;
  readonly name: string;
  readonly city: string;
  readonly blurb: string;
  readonly tiers: readonly Tier[];
  /** Roof over the top tier: a ring all round, a cantilever over part of it, or none. */
  readonly roof: { readonly kind: 'ring' | 'cantilever' | 'none'; readonly color: string };
  /** Light towers (how many, how tall, how far out), or lights on the roof. */
  readonly lights: { readonly kind: 'towers' | 'roof' | 'masts'; readonly count: number; readonly height: number; readonly r: number; readonly lean: number };
  readonly wall: string;
  readonly landmarks: readonly Landmark[];
  /** How full the stands are, 0–1. */
  readonly crowd: number;
}

export const VENUES: Readonly<Record<VenueId, Venue>> = {
  crease: {
    id: 'crease',
    name: 'Crease Park',
    city: 'Anywhere',
    blurb: 'A modern two-tier bowl with a ring roof and four light towers.',
    tiers: [
      { r: 80, y: 1.6, rows: 14, seats: ['#1f5f9e'] },
      { r: 96, y: 12, rows: 10, seats: ['#9e2a2b'] },
    ],
    roof: { kind: 'ring', color: '#d9dde3' },
    lights: { kind: 'towers', count: 4, height: 52, r: 112, lean: 0.35 },
    wall: '#2c4f2a',
    landmarks: [],
    crowd: 0.8,
  },
  lords: {
    id: 'lords',
    name: "Lord's",
    city: 'London',
    blurb: 'The Home of Cricket: the red-brick Pavilion, the Media Centre pod above the Nursery End, the tented Mound Stand, low stands and plane trees.',
    tiers: [
      // All round except the Pavilion End.
      { r: 78, y: 1.4, rows: 13, seats: ['#ece8dd', '#ece8dd', '#20365c'], arc: Math.PI * 2 - 1.0, facing: 0 },
      // Upper tiers only along the sides (the Compton and Edrich, the Grand Stand and the Warner).
      { r: 92, y: 9.5, rows: 7, seats: ['#ece8dd'], arc: Math.PI * 0.62, facing: Math.PI / 2 },
      { r: 92, y: 9.5, rows: 7, seats: ['#ece8dd'], arc: Math.PI * 0.62, facing: -Math.PI / 2 },
    ],
    roof: { kind: 'none', color: '#f2f2f2' },
    lights: { kind: 'masts', count: 4, height: 48, r: 104, lean: 0.25 },
    wall: '#1f4a2c',
    landmarks: ['pavilion', 'mediaCentre', 'moundCanopies', 'trees'],
    crowd: 0.86,
  },
  mcg: {
    id: 'mcg',
    name: 'MCG',
    city: 'Melbourne',
    blurb: 'A vast three-tier bowl under a cantilevered roof, ringed by six tall light towers.',
    tiers: [
      { r: 82, y: 1.6, rows: 15, seats: ['#1d2f5e', '#1d2f5e', '#c69214'] },
      { r: 98, y: 13, rows: 11, seats: ['#1d2f5e'] },
      { r: 110, y: 24, rows: 12, seats: ['#c69214', '#1d2f5e'] },
    ],
    roof: { kind: 'ring', color: '#e9ecef' },
    lights: { kind: 'towers', count: 6, height: 75, r: 132, lean: 0.5 },
    wall: '#103a28',
    landmarks: [],
    crowd: 0.72,
  },
  eden: {
    id: 'eden',
    name: 'Eden Gardens',
    city: 'Kolkata',
    blurb: 'A huge, noisy two-tier bowl of coloured seat blocks under a long cantilever roof, with floodlight towers above.',
    tiers: [
      { r: 80, y: 1.8, rows: 15, seats: ['#2b6bb3', '#e28a1f', '#2f8f4e', '#c8382e', '#e2c22f'] },
      { r: 97, y: 13, rows: 13, seats: ['#e28a1f', '#2b6bb3', '#2f8f4e'] },
    ],
    roof: { kind: 'cantilever', color: '#c9ced6' },
    lights: { kind: 'towers', count: 6, height: 60, r: 120, lean: 0.4 },
    wall: '#24502d',
    landmarks: [],
    crowd: 0.92,
  },
  wankhede: {
    id: 'wankhede',
    name: 'Wankhede',
    city: 'Mumbai',
    blurb: 'Steep stands close to the rope under a crown of white fabric canopies, the lights along the roof edge.',
    tiers: [
      { r: 76, y: 1.6, rows: 15, seats: ['#2457a8', '#2457a8', '#f0f0f0'] },
      { r: 91, y: 12.5, rows: 12, seats: ['#2457a8', '#f0f0f0'] },
    ],
    roof: { kind: 'none', color: '#f6f6f2' },
    lights: { kind: 'roof', count: 16, height: 28.5, r: 99, lean: 0.6 },
    wall: '#1f4a6b',
    landmarks: ['sails'],
    crowd: 0.9,
  },
};

export const VENUE_IDS = Object.keys(VENUES) as VenueId[];

/** The outermost point of the stands (for placing the screen and lights). */
export function standsOuterRadius(v: Venue): number {
  return Math.max(...v.tiers.map((t) => t.r + t.rows * 0.9));
}
