export interface AABB { x: number; z: number; w: number; d: number; }

export function collidesCircleAABB(x: number, z: number, r: number, b: AABB): boolean {
  const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
  const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
