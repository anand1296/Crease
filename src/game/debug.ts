/**
 * Read-only debug handles exposed on `window.__crease` so browser tests can
 * observe simulation state without scraping pixels. Never used for input.
 */
export interface CreaseDebug {
  ballPosition?: () => { x: number; y: number; z: number };
  deliveryIndex?: () => number;
  simSteps?: () => number;
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
