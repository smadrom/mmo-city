import { MAP_HALF, PLAYER_RADIUS, PLAYER_SPEED, PLAYER_SPRINT } from './config.js';

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

export interface MoveInput {
  up: boolean; down: boolean; left: boolean; right: boolean; sprint: boolean; rotY: number;
}

// Один шаг пешего движения — общий для сервера (тик) и клиента (предсказание),
// чтобы математика не расходилась. Без ввода возвращает позицию без изменений.
export function stepFoot(
  x: number, z: number, inp: MoveInput, dt: number, colliders: AABB[],
): { x: number; z: number } {
  const mf = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
  const mr = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (mf === 0 && mr === 0) return { x, z };
  const fx = -Math.sin(inp.rotY);
  const fz = -Math.cos(inp.rotY);
  const rx = Math.cos(inp.rotY);
  const rz = -Math.sin(inp.rotY);
  const mx = fx * mf + rx * mr;
  const mz = fz * mf + rz * mr;
  const len = Math.hypot(mx, mz);
  const speed = (inp.sprint ? PLAYER_SPRINT : PLAYER_SPEED) * dt / len;
  const res = moveCircle(x, z, mx * speed, mz * speed, PLAYER_RADIUS, colliders);
  return {
    x: clamp(res.x, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS),
    z: clamp(res.z, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS),
  };
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// 2D-пересечение отрезка с AABB (slab-метод). Касание грани = пересечение.
export function segmentHitsAABB(x1: number, z1: number, x2: number, z2: number, b: AABB): boolean {
  return segmentAABBEnterT(x1, z1, x2, z2, b) !== null;
}

// Параметр t∈[0,1] входа отрезка в AABB (для обрезки луча у стены); null — нет пересечения.
export function segmentAABBEnterT(x1: number, z1: number, x2: number, z2: number, b: AABB): number | null {
  const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
  const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
  let tmin = 0, tmax = 1;
  for (const [p, d, lo, hi] of [[x1, x2 - x1, minX, maxX], [z1, z2 - z1, minZ, maxZ]] as const) {
    if (d === 0) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t1 = (lo - p) / d;
    let t2 = (hi - p) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
