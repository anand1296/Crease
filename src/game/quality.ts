/**
 * Graphics quality. "Low" turns off shadows, the crowd and high-DPI
 * rendering for machines without a capable GPU. Defaults to Low when the
 * browser reports a software renderer; the player can override it.
 */
export type Quality = 'high' | 'low';

const KEY = 'crease.quality';

export function detectQuality(): Quality {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'high' || stored === 'low') return stored;
  } catch {
    // Storage unavailable: fall through to detection.
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(renderer)) return 'low';
  } catch {
    // No WebGL info: assume a capable machine.
  }
  return 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Not persisted; the setting still applies for this visit.
  }
}
