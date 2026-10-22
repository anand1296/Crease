/**
 * Read-only debug handles exposed on `window.__crease` so browser tests can
 * observe simulation state without scraping pixels. Never used for input.
 */
export interface CreaseDebug {
  ballPosition?: () => { x: number; y: number; z: number };
  simSteps?: () => number;
  /** Session phase and current ball phase. */
  phase?: () => string;
  ballPhase?: () => string | null;
  /** Seconds until the ball reaches the striker's popping crease (undefined when not in flight). */
  eta?: () => number | undefined;
  /** Number of balls completed this session. */
  balls?: () => number;
  /** Total runs and wickets. */
  score?: () => { runs: number; wickets: number; balls: number };
  lastHeadline?: () => string | undefined;
  /** Runs the simulation on by this many seconds without drawing. */
  advance?: (seconds: number) => void;
  /** Slows or speeds the simulation (tests and frame-by-frame captures only). */
  setSpeed?: (speed: number) => void;
  /** Pins the camera (tests and close-up captures only); undefined releases it. */
  /** Holds the toss scene at this many seconds after the coin is flicked (undefined: live). */
  pinToss?: (seconds: number | undefined) => void;
  /** Seconds into a decision review, while one is on. */
  drsTime?: () => number | undefined;
  /** The camera director's current shot. */
  shot?: () => string | undefined;
  setCamera?: (view: { pos: [number, number, number]; look: [number, number, number]; fov: number } | undefined) => void;
  /** Ball position, when one is in play or in the bowler's hand. */
  ballWorld?: () => [number, number, number] | undefined;
  /** The bowler's bowling hand (x, y, z) and seconds from release. */
  bowlerHand?: () => [number, number, number, number] | undefined;
  /** Where every player is drawn, the bowler, his mark, and where the field says each should stand. */
  players?: () => {
    bowler: string;
    mark: { x: number; z: number };
    at: { id: string; x: number; z: number }[];
    field: { id: string; x: number; z: number; role: string }[];
  };
  /** Renderer statistics: draw calls, programs, textures, scene objects, pixel ratio, adaptive level. */
  renderInfo?: () => { calls: number; triangles: number; programs: number; textures: number; geometries: number; objects: number; dpr: number; perf: number };
}

declare global {
  interface Window {
    __crease?: CreaseDebug;
  }
}

/** Merges `patch` into the debug handle and returns a function that removes those entries again (if still its own). */
export function exposeDebug(patch: CreaseDebug): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.__crease = { ...window.__crease, ...patch };
  return () => {
    const handle = window.__crease as Record<string, unknown> | undefined;
    if (!handle) return;
    for (const [key, value] of Object.entries(patch)) if (handle[key] === value) Reflect.deleteProperty(handle, key);
  };
}
