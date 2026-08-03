import {
  CAR_RADIUS, CAR_ENTER_DIST, CAR_PARK_RETURN_MS, MAP_HALF, PLAYER_RADIUS,
  RUNOVER_MIN_SPEED, RUNOVER_DAMAGE_K, RUNOVER_KNOCKBACK_K, RUNOVER_REPEAT_MS, CAR_CRASH_SPEED_KEEP,
  collidesAny, clamp, dist2, moveCircle, inAnyAABB, stepCar,
  type AABB, type ParkingSpot, type CarStepState,
} from '@mmo/shared';
import type { GameState, Car } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';
import { killPlayer, type Hit, type KillEvent } from './combat.js';

export interface CarRuntime { emptySince: number }

export function tickVehicles(
  state: GameState,
  runtimes: Map<string, Runtime>,
  carRuntime: Map<string, CarRuntime>,
  colliders: AABB[],
  dt: number,
  now: number,
  parkingSpots: ParkingSpot[],
  safeZones: AABB[] = [],
  events?: KillEvent[],
): Hit[] {
  const hits: Hit[] = [];
  state.cars.forEach((car, id) => {
    const crt = carRuntime.get(id);
    if (!crt) return;

    if (car.driverId) {
      crt.emptySince = 0;
      const driver = state.players.get(car.driverId);
      const rt = runtimes.get(car.driverId);
      if (!driver || !rt || driver.mode !== 'car') {
        car.driverId = '';
        car.speed = 0;
        return;
      }
      // вся физика водителя — в shared.stepCar: клиент шагает её же для предсказания
      const s: CarStepState = { x: car.x, z: car.z, rotY: car.rotY, speed: car.speed };
      const { steer } = stepCar(s, rt.input, dt, colliders, safeZones);
      car.x = s.x; car.z = s.z; car.rotY = s.rotY; car.speed = s.speed;
      car.steer = steer;
      driver.x = car.x;
      driver.z = car.z;
      driver.rotY = car.rotY;

      // наезд: пешеходы (включая зомби) в радиусе контакта, вне беззон
      const sp = Math.abs(car.speed);
      if (sp > 0) {
        state.players.forEach((v, vid) => {
          if (vid === car.driverId || v.mode !== 'foot') return;
          if (inAnyAABB(v.x, v.z, safeZones)) return;
          const R = CAR_RADIUS + PLAYER_RADIUS;
          const d2 = dist2(v.x, v.z, car.x, car.z);
          if (d2 > R * R || d2 === 0) return;
          const len = Math.sqrt(d2);
          const kb = Math.min(6, sp * RUNOVER_KNOCKBACK_K) * (sp > RUNOVER_MIN_SPEED ? 1 : 0.5);
          const res = moveCircle(v.x, v.z, ((v.x - car.x) / len) * kb, ((v.z - car.z) / len) * kb, PLAYER_RADIUS, colliders);
          v.x = clamp(res.x, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
          v.z = clamp(res.z, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
          if (sp <= RUNOVER_MIN_SPEED) return; // медленный контакт — только толчок
          const vrt = runtimes.get(vid);
          if (!vrt || now - vrt.lastDamageAt < RUNOVER_REPEAT_MS) return;
          const damage = Math.round(sp * RUNOVER_DAMAGE_K);
          v.hp -= damage;
          vrt.lastDamageAt = now;
          hits.push({ victim: vid, damage, x: v.x, z: v.z, attacker: car.driverId });
          if (v.hp <= 0) killPlayer(state, runtimes, car.driverId, vid, now, events);
        });
      }
    } else {
      car.speed = 0;
      car.steer = 0;
      if (crt.emptySince === 0) {
        crt.emptySince = now;
      } else if (now - crt.emptySince > CAR_PARK_RETURN_MS) {
        const spot = parkingSpots.find(s => s.id === id);
        if (spot) {
          car.x = spot.x;
          car.z = spot.z;
          car.rotY = 0;
        }
        crt.emptySince = 0;
      }
    }
  });

  // таран: развести перекрывшиеся машины, погасить скорости
  const cars = [...state.cars.values()];
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i];
      const B = cars[j];
      const d2 = dist2(A.x, A.z, B.x, B.z);
      const R = CAR_RADIUS * 2;
      if (d2 >= R * R || d2 === 0) continue;
      const len = Math.sqrt(d2);
      const overlap = (R - len) / 2;
      const ux = (B.x - A.x) / len;
      const uz = (B.z - A.z) / len;
      A.x = clamp(A.x - ux * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      A.z = clamp(A.z - uz * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      B.x = clamp(B.x + ux * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      B.z = clamp(B.z + uz * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      A.speed *= CAR_CRASH_SPEED_KEEP;
      B.speed *= CAR_CRASH_SPEED_KEEP;
    }
  }
  return hits;
}

export function tryEnterCar(state: GameState, playerId: string): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'foot') return false;
  let best: Car | null = null;
  let bestD = CAR_ENTER_DIST * CAR_ENTER_DIST;
  state.cars.forEach((car) => {
    if (car.driverId) return;
    const d2 = dist2(p.x, p.z, car.x, car.z);
    if (d2 < bestD) {
      best = car;
      bestD = d2;
    }
  });
  if (!best) return false;
  const chosen: Car = best;
  chosen.driverId = playerId;
  p.mode = 'car';
  p.carId = chosen.id;
  p.x = chosen.x;
  p.z = chosen.z;
  return true;
}

export function tryExitCar(state: GameState, playerId: string, colliders: AABB[]): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'car') return false;
  const car = state.cars.get(p.carId);
  if (car) {
    car.driverId = '';
    car.speed = 0;
    // высаживаем в первую свободную точку вокруг машины (иначе можно оказаться в здании)
    const cand: [number, number][] = [
      [Math.cos(car.rotY) * 2, -Math.sin(car.rotY) * 2],   // перед (как раньше)
      [-Math.cos(car.rotY) * 2, Math.sin(car.rotY) * 2],   // зад
      [Math.sin(car.rotY) * 2, Math.cos(car.rotY) * 2],    // бок
      [-Math.sin(car.rotY) * 2, -Math.cos(car.rotY) * 2],  // другой бок
    ];
    let ox = 0, oz = 0; // фолбэк — центр машины, если всё занято
    for (const [dx, dz] of cand) {
      if (!collidesAny(car.x + dx, car.z + dz, PLAYER_RADIUS, colliders)) { ox = dx; oz = dz; break; }
    }
    p.x = clamp(car.x + ox, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
    p.z = clamp(car.z + oz, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
  }
  p.mode = 'foot';
  p.carId = '';
  return true;
}
