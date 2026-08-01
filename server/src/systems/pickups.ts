import {
  WEAPONS, AMMO_PACK_SIZE, AMMO_MAX, PICKUP_RESPAWN_MS, PICKUP_RADIUS,
  dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import { GameState, Pickup } from '../schema/GameState.js';

export interface PickupRuntime { respawnAt: number }

const REGULAR_KINDS = ['bat', 'pistol', 'rifle', 'ammo'] as const;

function randomKind(): string {
  return REGULAR_KINDS[Math.floor(Math.random() * REGULAR_KINDS.length)];
}

export function spawnPickups(state: GameState, map: CityMap, runtimes: Map<string, PickupRuntime>): void {
  map.pickupSpots.forEach((s, i) => {
    const pk = new Pickup();
    pk.id = `pk${i}`;
    pk.kind = randomKind();
    pk.x = s.x;
    pk.z = s.z;
    state.pickups.set(pk.id, pk);
    runtimes.set(pk.id, { respawnAt: 0 });
  });
}

// денежный дроп при убийстве: без runtime-записи — не респаунится, удаляется при подборе
export function spawnCashDrop(state: GameState, x: number, z: number, amount: number, id: string): void {
  const pk = new Pickup();
  pk.id = id;
  pk.kind = 'cash';
  pk.x = x;
  pk.z = z;
  pk.amount = amount;
  state.pickups.set(id, pk);
}

// дроп оружия с трупа: как деньги — без runtime, после подбора удаляется (не респаунится)
export function spawnWeaponDrop(state: GameState, x: number, z: number, kind: string, id: string): void {
  const pk = new Pickup();
  pk.id = id;
  pk.kind = kind;
  pk.x = x;
  pk.z = z;
  state.pickups.set(id, pk);
}

export function tickPickups(state: GameState, runtimes: Map<string, PickupRuntime>, now: number): void {
  state.pickups.forEach((pk, id) => {
    if (!pk.active) {
      const rt = runtimes.get(id);
      if (rt && now >= rt.respawnAt) {
        pk.kind = randomKind();
        pk.active = true;
      }
      return;
    }
    state.players.forEach((p) => {
      if (!pk.active) return;
      if (p.mode !== 'foot' || p.role === 'zombie') return;
      if (dist2(p.x, p.z, pk.x, pk.z) > PICKUP_RADIUS * PICKUP_RADIUS) return;
      if (pk.kind === 'cash') {
        p.cash += pk.amount;
        pk.active = false; // защита от двойного подбора в один тик
        state.pickups.delete(id);
        return;
      }
      if (pk.kind === 'ammo') {
        p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
      } else {
        p.weapon = pk.kind; // замена без возврата, как покупка
        if (WEAPONS[pk.kind as WeaponKind]?.ranged) {
          p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
        }
      }
      const rt = runtimes.get(id);
      pk.active = false; // защита от двойного подбора в один тик, как у cash
      if (!rt) {
        state.pickups.delete(id); // дроп с трупа — подобрали и нет, респаун только у регулярных
        return;
      }
      rt.respawnAt = now + PICKUP_RESPAWN_MS;
    });
  });
}
