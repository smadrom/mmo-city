import {
  WEAPONS, AMMO_PACK_PRICE, AMMO_PACK_SIZE, AMMO_MAX, DOOR_DIST,
  dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import type { GameState, Player } from '../schema/GameState.js';

export type BuyWeaponResult = 'ok' | 'too_far' | 'no_money' | 'bad_kind';
export type BuyAmmoResult = 'ok' | 'too_far' | 'no_money';

function buyerAtShop(state: GameState, playerId: string, map: CityMap): Player | null {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'foot') return null;
  if (dist2(p.x, p.z, map.gunShop.x, map.gunShop.z) > DOOR_DIST * DOOR_DIST) return null;
  return p;
}

export function tryBuyWeapon(state: GameState, playerId: string, kind: string, map: CityMap): BuyWeaponResult {
  const p = buyerAtShop(state, playerId, map);
  if (!p) return 'too_far';
  if (!(kind in WEAPONS)) return 'bad_kind';
  const w = WEAPONS[kind as WeaponKind];
  if (p.cash < w.price) return 'no_money';
  p.cash -= w.price;
  p.weapon = kind; // замена старого без возврата (спека 2)
  return 'ok';
}

export function tryBuyAmmo(state: GameState, playerId: string, map: CityMap): BuyAmmoResult {
  const p = buyerAtShop(state, playerId, map);
  if (!p) return 'too_far';
  if (p.cash < AMMO_PACK_PRICE) return 'no_money';
  p.cash -= AMMO_PACK_PRICE;
  p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
  return 'ok';
}
