import {
  DELIVERY_REWARD, DELIVERY_TIME_MS, DELIVERY_PICKUP_DIST, DELIVERY_DROP_DIST,
  TRANSFER_MIN, TRANSFER_MAX,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState, Player } from '../schema/GameState.js';
import type { GameDB } from '../db.js';

export function canTakeDelivery(p: Player): boolean {
  return p.mode === 'car' && !p.cargo;
}

export function assignDelivery(p: Player, map: CityMap, now: number): void {
  const t = map.deliveryTargets[Math.floor(Math.random() * map.deliveryTargets.length)];
  p.cargo = true;
  p.deliveryTarget = t.id;
  p.deliveryDeadline = now + DELIVERY_TIME_MS;
}

export function tryStartDelivery(
  state: GameState,
  playerId: string,
  map: CityMap,
  now: number,
): boolean {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return false;
  if (dist2(p.x, p.z, map.warehouse.x, map.warehouse.z) > DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) return false;
  assignDelivery(p, map, now);
  return true;
}

// телефон: тот же заказ, но без поездки на склад (машина всё равно обязательна)
export function tryTakeJob(state: GameState, playerId: string, map: CityMap, now: number): boolean {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return false;
  assignDelivery(p, map, now);
  return true;
}

export function tryDropJob(state: GameState, playerId: string): boolean {
  const p = state.players.get(playerId);
  if (!p || !p.cargo) return false;
  p.cargo = false;
  p.deliveryTarget = '';
  return true;
}

export function tickDelivery(state: GameState, map: CityMap, now: number): void {
  state.players.forEach((p) => {
    if (!p.cargo) return;
    if (now > p.deliveryDeadline) {
      p.cargo = false;
      p.deliveryTarget = '';
      return;
    }
    if (p.mode !== 'car') return; // сдавать груз можно только из машины
    const t = map.deliveryTargets.find(t => t.id === p.deliveryTarget);
    if (t && dist2(p.x, p.z, t.x, t.z) < DELIVERY_DROP_DIST * DELIVERY_DROP_DIST) {
      p.cargo = false;
      p.deliveryTarget = '';
      p.cash += DELIVERY_REWARD;
    }
  });
}

export type TransferError = 'bad_amount' | 'self' | 'no_such_user' | 'no_money';

export function tryTransfer(
  state: GameState,
  db: GameDB,
  playerId: string,
  to: unknown,
  amount: unknown,
  now: number,
): { ok: boolean; error?: TransferError; balance?: number; toNick?: string; amount?: number } {
  const p = state.players.get(playerId);
  if (!p) return { ok: false, error: 'no_money' };
  const sum = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isInteger(sum) || sum < TRANSFER_MIN || sum > TRANSFER_MAX) return { ok: false, error: 'bad_amount' };
  const toNick = typeof to === 'string' ? to.trim() : '';
  if (!toNick) return { ok: false, error: 'no_such_user' };
  if (toNick === p.name) return { ok: false, error: 'self' };
  if (!db.hasPlayer(toNick)) return { ok: false, error: 'no_such_user' };
  if (!db.transfer(p.name, toNick, sum, now)) return { ok: false, error: 'no_money' };
  p.cash -= sum;
  state.players.forEach((pl) => { if (pl.name === toNick) pl.cash += sum; });
  return { ok: true, balance: p.cash, toNick, amount: sum };
}
