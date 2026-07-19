import {
  CAR_RADIUS, CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG, CAR_TURN_RATE,
  CAR_ENTER_DIST, CAR_PARK_RETURN_MS, MAP_HALF,
  collidesAny, clamp, dist2, type AABB, type ParkingSpot,
} from '@mmo/shared';
import type { GameState, Car } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export interface CarRuntime { emptySince: number }

export function tickVehicles(
  state: GameState,
  runtimes: Map<string, Runtime>,
  carRuntime: Map<string, CarRuntime>,
  colliders: AABB[],
  dt: number,
  now: number,
  parkingSpots: ParkingSpot[],
): void {
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
      const inp = rt.input;
      if (inp.up) car.speed = Math.min(CAR_MAX_SPEED, car.speed + CAR_ACCEL * dt);
      else if (inp.down) {
        car.speed = car.speed > 0
          ? Math.max(0, car.speed - CAR_BRAKE * dt)
          : Math.max(-CAR_REVERSE_SPEED, car.speed - CAR_ACCEL * dt);
      } else if (car.speed > 0) car.speed = Math.max(0, car.speed - CAR_DRAG * dt);
      else if (car.speed < 0) car.speed = Math.min(0, car.speed + CAR_DRAG * dt);

      const steer = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
      const agility = Math.min(1, Math.abs(car.speed) / 3) * (1 - 0.6 * (Math.abs(car.speed) / CAR_MAX_SPEED));
      car.rotY += steer * CAR_TURN_RATE * agility * Math.sign(car.speed) * dt;

      if (car.speed !== 0) {
        const nx = clamp(car.x - Math.sin(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        const nz = clamp(car.z - Math.cos(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        if (collidesAny(nx, nz, CAR_RADIUS, colliders)) {
          car.speed = 0;
        } else {
          car.x = nx;
          car.z = nz;
        }
      }
      driver.x = car.x;
      driver.z = car.z;
      driver.rotY = car.rotY;
    } else {
      car.speed = 0;
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

export function tryExitCar(state: GameState, playerId: string): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'car') return false;
  const car = state.cars.get(p.carId);
  if (car) {
    car.driverId = '';
    car.speed = 0;
    p.x = car.x + Math.cos(car.rotY) * 2;
    p.z = car.z - Math.sin(car.rotY) * 2;
  }
  p.mode = 'foot';
  p.carId = '';
  return true;
}
