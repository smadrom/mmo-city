import {
  deliveryReward, DELIVERY_TIME_MS, DELIVERY_PICKUP_DIST, DELIVERY_DROP_DIST,
  TRANSFER_MIN, TRANSFER_MAX, TRANSFER_MIN_PLAYTIME_SEC, TRANSFER_IP_DAILY_LIMIT,
  JOB_RETRY_COOLDOWN_MS,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState, Player } from '../schema/GameState.js';
import type { GameDB } from '../db.js';
import type { Runtime } from '../runtime.js';

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
  rt: Runtime,
): boolean {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return false;
  if (now < rt.nextJobAt) return false; // кулдаун после отказа/просрочки
  if (dist2(p.x, p.z, map.warehouse.x, map.warehouse.z) > DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) return false;
  assignDelivery(p, map, now);
  return true;
}

export type TakeJobResult = 'ok' | 'need_car' | 'job_cooldown';

// телефон: тот же заказ, но без поездки на склад (машина всё равно обязательна)
export function tryTakeJob(state: GameState, playerId: string, map: CityMap, now: number, rt: Runtime): TakeJobResult {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return 'need_car';
  if (now < rt.nextJobAt) return 'job_cooldown';
  assignDelivery(p, map, now);
  return 'ok';
}

export function tryDropJob(state: GameState, playerId: string, rt: Runtime, now: number): boolean {
  const p = state.players.get(playerId);
  if (!p || !p.cargo) return false;
  p.cargo = false;
  p.deliveryTarget = '';
  rt.nextJobAt = now + JOB_RETRY_COOLDOWN_MS; // ре-ролл заказов — с паузой
  return true;
}

export function tickDelivery(state: GameState, map: CityMap, now: number, runtimes: Map<string, Runtime>): void {
  state.players.forEach((p, id) => {
    if (!p.cargo) return;
    if (now > p.deliveryDeadline) {
      p.cargo = false;
      p.deliveryTarget = '';
      const rt = runtimes.get(id);
      if (rt) rt.nextJobAt = now + JOB_RETRY_COOLDOWN_MS; // просрочил — пауза на новый заказ
      return;
    }
    if (p.mode !== 'car') return; // сдавать груз можно только из машины
    const t = map.deliveryTargets.find(t => t.id === p.deliveryTarget);
    if (t && dist2(p.x, p.z, t.x, t.z) < DELIVERY_DROP_DIST * DELIVERY_DROP_DIST) {
      const reward = deliveryReward(map, p.deliveryTarget); // до очистки target
      p.cargo = false;
      p.deliveryTarget = '';
      p.cash += reward;
    }
  });
}

export type TransferError = 'bad_amount' | 'self' | 'no_such_user' | 'no_money' | 'need_playtime' | 'ip_limit';

export function tryTransfer(
  state: GameState,
  db: GameDB,
  playerId: string,
  to: unknown,
  amount: unknown,
  now: number,
  guard: { playtimeSec: number; ip: string }, // антимультиаккаунт: наигрыш отправителя + его IP
): { ok: boolean; error?: TransferError; balance?: number; toNick?: string; amount?: number } {
  const p = state.players.get(playerId);
  if (!p) return { ok: false, error: 'no_money' };
  if (guard.playtimeSec < TRANSFER_MIN_PLAYTIME_SEC) return { ok: false, error: 'need_playtime' };
  const sum = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isInteger(sum) || sum < TRANSFER_MIN || sum > TRANSFER_MAX) return { ok: false, error: 'bad_amount' };
  const toNick = typeof to === 'string' ? to.trim() : '';
  if (!toNick) return { ok: false, error: 'no_such_user' };
  if (toNick === p.name) return { ok: false, error: 'self' };
  if (!db.hasPlayer(toNick)) return { ok: false, error: 'no_such_user' };
  if (p.cash < sum) return { ok: false, error: 'no_money' }; // state авторитетен: БД отстаёт до 5с (savePlayer)
  if (db.ipTransferSum(guard.ip, now - 24 * 3600_000) + sum > TRANSFER_IP_DAILY_LIMIT) return { ok: false, error: 'ip_limit' };
  if (!db.transfer(p.name, toNick, sum, now, guard.ip)) return { ok: false, error: 'no_money' };
  p.cash -= sum;
  state.players.forEach((pl) => { if (pl.name === toNick) pl.cash += sum; });
  return { ok: true, balance: p.cash, toNick, amount: sum };
}
