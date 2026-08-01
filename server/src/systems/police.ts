import {
  ARREST_RANGE, ARREST_TIME_MS, ARREST_CASH_LOSS, ARREST_BONUS, JAIL_TIME_MS,
  COP_SALARY, COP_SALARY_INTERVAL_MS, COP_PATROL_MIN_DIST, MAX_HP,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export function tickPolice(
  state: GameState,
  runtimes: Map<string, Runtime>,
  now: number,
  dt: number,
  map: CityMap,
): { cop: string; crim: string }[] {
  const arrests: { cop: string; crim: string }[] = [];
  // Зарплаты
  state.players.forEach((p, id) => {
    const rt = runtimes.get(id);
    if (!rt) return;
    if (p.role === 'cop' && p.mode !== 'dead' && now >= rt.nextSalaryAt) {
      // платим только за патруль: коп должен сместиться от прошлого якоря, иначе AFK-фарм
      const moved = dist2(p.x, p.z, rt.salaryAnchorX, rt.salaryAnchorZ) >= COP_PATROL_MIN_DIST * COP_PATROL_MIN_DIST;
      if (moved) p.cash += COP_SALARY;
      // окно и якорь двигаем в любом случае — AFK-коп не копит «долг» на разовую выплату
      rt.nextSalaryAt = now + COP_SALARY_INTERVAL_MS;
      rt.salaryAnchorX = p.x;
      rt.salaryAnchorZ = p.z;
    }
  });

  // Аресты
  state.players.forEach((crim, crimId) => {
    const crt = runtimes.get(crimId);
    if (!crt || crt.frozen) return; // замороженного призрака не арестовываем (не может защититься)
    const wanted = crim.wantedUntil > now && crim.mode !== 'jail' && crim.mode !== 'dead';
    if (!wanted) {
      crt.arrestProgress = 0;
      return;
    }
    let copId = '';
    state.players.forEach((cop, id) => {
      if (copId) return;
      if (cop.role !== 'cop' || cop.wantedUntil > now) return;
      if (cop.mode !== 'foot' && cop.mode !== 'car') return;
      if (dist2(cop.x, cop.z, crim.x, crim.z) < ARREST_RANGE * ARREST_RANGE) copId = id;
    });
    if (!copId) {
      crt.arrestProgress = 0;
      return;
    }
    crt.arrestProgress += dt * 1000;
    if (crt.arrestProgress < ARREST_TIME_MS) return;

    if (crim.mode === 'car') {
      const car = state.cars.get(crim.carId);
      if (car) {
        car.driverId = '';
        car.speed = 0;
      }
      crim.carId = '';
    }
    crim.mode = 'jail';
    crim.x = map.jailCell.x;
    crim.z = map.jailCell.z;
    crim.jailUntil = now + JAIL_TIME_MS;
    crim.wantedUntil = 0;
    crim.cash = Math.floor(crim.cash * (1 - ARREST_CASH_LOSS));
    crim.cargo = false;
    crim.deliveryTarget = '';
    crim.weapon = '';
    crim.ammo = 0;
    crt.arrestProgress = 0;
    const cop = state.players.get(copId);
    if (cop) cop.cash += ARREST_BONUS;
    arrests.push({ cop: cop?.name ?? '', crim: crim.name }); // ники для feed-сообщения об аресте
  });

  // Освобождение
  state.players.forEach((p) => {
    if (p.mode === 'jail' && now >= p.jailUntil) {
      p.mode = 'foot';
      p.x = map.policeDoor.x;
      p.z = map.policeDoor.z;
      p.hp = MAX_HP;
    }
  });
  return arrests;
}
