export interface AABB { x: number; z: number; w: number; d: number; }

export function collidesCircleAABB(x: number, z: number, r: number, b: AABB): boolean {
  const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
  const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function collidesAny(x: number, z: number, r: number, boxes: AABB[]): boolean {
  return boxes.some(b => collidesCircleAABB(x, z, r, b));
}

export function moveCircle(
  x: number, z: number, dx: number, dz: number, r: number, boxes: AABB[],
): { x: number; z: number } {
  let nx = x + dx;
  if (collidesAny(nx, z, r, boxes)) nx = x;
  let nz = z + dz;
  if (collidesAny(nx, nz, r, boxes)) nz = z;
  return { x: nx, z: nz };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
