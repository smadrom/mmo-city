import { RENT_PRICE, RENT_INTERVAL_MS, SAFE_LIMIT, DOOR_DIST, dist2 } from '@mmo/shared';
import type { GameState, Apartment } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

function nearApartment(state: GameState, x: number, z: number): Apartment | null {
  let found: Apartment | null = null;
  state.apartments.forEach((a) => {
    if (found) return;
    if (dist2(x, z, a.doorX, a.doorZ) < DOOR_DIST * DOOR_DIST) found = a;
  });
  return found;
}

export function tryRent(
  state: GameState,
  runtimes: Map<string, Runtime>,
  playerId: string,
  now: number,
): 'ok' | 'too_far' | 'taken' | 'no_money' {
  const p = state.players.get(playerId);
  if (!p) return 'too_far';
  const apt = nearApartment(state, p.x, p.z);
  if (!apt) return 'too_far';
  if (apt.rentedBy) return 'taken';
  if (p.cash < RENT_PRICE) return 'no_money';
  p.cash -= RENT_PRICE;
  if (p.apt) {
    const old = state.apartments.get(p.apt);
    if (old) old.rentedBy = '';
  }
  apt.rentedBy = p.name;
  p.apt = apt.id;
  const rt = runtimes.get(playerId);
  if (rt) rt.nextRentAt = now + RENT_INTERVAL_MS;
  return 'ok';
}

export function adjustSafe(state: GameState, playerId: string, amount: number): boolean {
  const p = state.players.get(playerId);
  if (!p || !p.apt) return false;
  const apt = state.apartments.get(p.apt);
  if (!apt || apt.rentedBy !== p.name) return false;
  if (dist2(p.x, p.z, apt.doorX, apt.doorZ) > DOOR_DIST * DOOR_DIST) return false;
  if (amount > 0) {
    const v = Math.min(amount, p.cash, SAFE_LIMIT - p.safe);
    if (v <= 0) return false;
    p.cash -= v;
    p.safe += v;
    return true;
  }
  if (amount < 0) {
    const v = Math.min(-amount, p.safe);
    if (v <= 0) return false;
    p.safe -= v;
    p.cash += v;
    return true;
  }
  return false;
}

export function tickRent(state: GameState, runtimes: Map<string, Runtime>, now: number): void {
  state.players.forEach((p, id) => {
    if (!p.apt) return;
    const rt = runtimes.get(id);
    if (!rt || now < rt.nextRentAt) return;
    rt.nextRentAt = now + RENT_INTERVAL_MS;
    if (p.cash >= RENT_PRICE) {
      p.cash -= RENT_PRICE;
    } else {
      const apt = state.apartments.get(p.apt);
      if (apt) apt.rentedBy = '';
      p.apt = '';
    }
  });
}
