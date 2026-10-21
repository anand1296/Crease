/**
 * Minimal mutable 3-vector for the simulation. Deliberately independent of
 * three.js so the simulation can run and be tested without the renderer.
 *
 * Coordinate system (metres): x = across the pitch (+x towards the off side
 * of a right-handed striker), y = up, z = along the pitch towards the
 * striker. The pitch centre is the origin.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const copyVec3 = (out: Vec3, v: Readonly<Vec3>): Vec3 => {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
};

export const length3 = (v: Readonly<Vec3>): number => Math.hypot(v.x, v.y, v.z);

export const lerpVec3 = (out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>, t: number): Vec3 => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
};

export const isFiniteVec3 = (v: Readonly<Vec3>): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
