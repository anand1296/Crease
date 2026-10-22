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
  /** Renderer statistics: draw calls, programs, textures, scene objects, pixel ratio, adaptive level. */
  renderInfo?: () => { calls: number; triangles: number; programs: number; textures: number; geometries: number; objects: number; dpr: number; perf: number };
}

declare global {
  interface Window {
    __crease?: CreaseDebug;
  }
}

/** Merges `patch` into the debug handle and returns a function that undoes it. */
export function exposeDebug(patch: CreaseDebug): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const previous = window.__crease;
  window.__crease = { ...previous, ...patch };
  return () => {
    if (previous) window.__crease = previous;
    else delete window.__crease;
  };
}
