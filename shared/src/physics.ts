import {
  MAP_HALF, PLAYER_RADIUS, PLAYER_SPEED, PLAYER_SPRINT,
  CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG, CAR_TURN_RATE, CAR_RADIUS,
  CAR_NITRO_SPEED_MULT, CAR_NITRO_ACCEL_MULT, CAR_CRASH_BOUNCE,
} from './config.js';

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

export function pointInAABB(x: number, z: number, b: AABB): boolean {
  return x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2;
}

export function inAnyAABB(x: number, z: number, boxes: AABB[]): boolean {
  return boxes.some(b => pointInAABB(x, z, b));
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
  speedWalk = PLAYER_SPEED,
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
  const speed = (inp.sprint ? PLAYER_SPRINT : speedWalk) * dt / len;
  const res = moveCircle(x, z, mx * speed, mz * speed, PLAYER_RADIUS, colliders);
  return {
    x: clamp(res.x, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS),
    z: clamp(res.z, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS),
  };
}

export interface CarStepState { x: number; z: number; rotY: number; speed: number }

// Один шаг машины — общий для сервера (тик) и клиента (предсказание своей машины),
// чтобы математика не расходилась. Мутирует s, возвращает steer для отображения руля.
export function stepCar(
  s: CarStepState, inp: MoveInput, dt: number, colliders: AABB[], safeZones: AABB[] = [],
): { steer: number } {
  const nitro = inp.sprint;
  const maxSpeed = nitro ? CAR_MAX_SPEED * CAR_NITRO_SPEED_MULT : CAR_MAX_SPEED;
  const accel = nitro ? CAR_ACCEL * CAR_NITRO_ACCEL_MULT : CAR_ACCEL;
  if (inp.up) s.speed = Math.min(maxSpeed, s.speed + accel * dt);
  else if (inp.down) {
    s.speed = s.speed > 0
      ? Math.max(0, s.speed - CAR_BRAKE * dt)
      : Math.max(-CAR_REVERSE_SPEED, s.speed - accel * dt);
  } else if (s.speed > 0) s.speed = Math.max(0, s.speed - CAR_DRAG * dt);
  else if (s.speed < 0) s.speed = Math.min(0, s.speed + CAR_DRAG * dt);

  const steer = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
  // agility: на стоянке руль не ворочается, на максималке подруливает слабее
  const agility = Math.min(1, Math.abs(s.speed) / 3) * (1 - 0.6 * (Math.abs(s.speed) / CAR_MAX_SPEED));
  s.rotY += steer * CAR_TURN_RATE * agility * Math.sign(s.speed) * dt;

  if (s.speed !== 0) {
    const nx = clamp(s.x - Math.sin(s.rotY) * s.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
    const nz = clamp(s.z - Math.cos(s.rotY) * s.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
    if (collidesAny(nx, nz, CAR_RADIUS, colliders)) {
      s.speed = -s.speed * CAR_CRASH_BOUNCE; // отскок, не гвозди
    } else if (inAnyAABB(nx, nz, safeZones)) {
      // граница безопасной зоны разворачивает (как в GTA SA)
      s.speed = 0;
      s.rotY += Math.PI;
    } else {
      s.x = nx;
      s.z = nz;
    }
  }
  return { steer };
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
