import {
  DELIVERY_REWARD, DELIVERY_TIME_MS, DELIVERY_PICKUP_DIST, DELIVERY_DROP_DIST,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';

export function tryStartDelivery(
  state: GameState,
  playerId: string,
  map: CityMap,
  now: number,
): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'car' || p.cargo) return false;
  if (dist2(p.x, p.z, map.warehouse.x, map.warehouse.z) > DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) return false;
  const t = map.deliveryTargets[Math.floor(Math.random() * map.deliveryTargets.length)];
  p.cargo = true;
  p.deliveryTarget = t.id;
  p.deliveryDeadline = now + DELIVERY_TIME_MS;
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
    const t = map.deliveryTargets.find(t => t.id === p.deliveryTarget);
    if (t && dist2(p.x, p.z, t.x, t.z) < DELIVERY_DROP_DIST * DELIVERY_DROP_DIST) {
      p.cargo = false;
      p.deliveryTarget = '';
      p.cash += DELIVERY_REWARD;
    }
  });
}
