import {
  PUNCH_RANGE, PUNCH_DAMAGE, PUNCH_COOLDOWN_MS, MAX_HP,
  DEATH_CASH_LOSS, WANTED_DURATION_MS, RESPAWN_DELAY_MS,
  WEAPONS, segmentHitsAABB, segmentAABBEnterT, dist2,
  type AABB, type CityMap, type Point, type WeaponKind,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export interface Shot {
  from: Point;
  to: Point;
  hit: boolean;
  victim: string; // sessionId цели, '' при промахе
}

export function handleAttack(
  state: GameState,
  runtimes: Map<string, Runtime>,
  attackerId: string,
  now: number,
  colliders: AABB[],
): Shot | null {
  const a = state.players.get(attackerId);
  const art = runtimes.get(attackerId);
  if (!a || !art || a.mode !== 'foot') return null;
  const w = a.weapon && Object.hasOwn(WEAPONS, a.weapon) ? WEAPONS[a.weapon as WeaponKind] : null;
  const ranged = w?.ranged === true;
  const range = w ? w.range : PUNCH_RANGE;
  const damage = w ? w.damage : PUNCH_DAMAGE;
  const cooldownMs = w ? w.cooldownMs : PUNCH_COOLDOWN_MS;
  if (now - art.lastAttackAt < cooldownMs) return null;
  if (ranged && a.ammo <= 0) return null;

  const fx = -Math.sin(a.rotY);
  const fz = -Math.cos(a.rotY);
  const minDot = ranged ? 0.98 : 0.3;
  let bestId = '';
  let bestD = range * range;
  state.players.forEach((t, id) => {
    if (id === attackerId) return;
    if (t.mode === 'jail' || t.mode === 'dead') return;
    const d2 = dist2(a.x, a.z, t.x, t.z);
    if (d2 > bestD || d2 === 0) return;
    const len = Math.sqrt(d2);
    const dot = ((t.x - a.x) / len) * fx + ((t.z - a.z) / len) * fz;
    if (dot < minDot) return;
    if (ranged && colliders.some(b => segmentHitsAABB(a.x, a.z, t.x, t.z, b))) return;
    bestId = id;
    bestD = d2;
  });
  art.lastAttackAt = now;

  if (ranged) {
    a.ammo -= 1;
    if (!bestId) {
      // tracer обрезаем у ближайшей стены — луч не рисуется сквозь здания
      let tWall = 1;
      for (const b of colliders) {
        const t = segmentAABBEnterT(a.x, a.z, a.x + fx * range, a.z + fz * range, b);
        if (t !== null && t < tWall) tWall = t;
      }
      return { from: { x: a.x, z: a.z }, to: { x: a.x + fx * range * tWall, z: a.z + fz * range * tWall }, hit: false, victim: '' };
    }
    const victim = state.players.get(bestId)!;
    victim.hp -= damage;
    const vrt = runtimes.get(bestId);
    if (vrt) vrt.lastDamageAt = now;
    if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
    return { from: { x: a.x, z: a.z }, to: { x: victim.x, z: victim.z }, hit: true, victim: bestId };
  }

  if (!bestId) return null;
  const victim = state.players.get(bestId);
  const vrt = runtimes.get(bestId);
  if (!victim || !vrt) return null;
  victim.hp -= damage;
  vrt.lastDamageAt = now;
  if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
  return null;
}

export function killPlayer(
  state: GameState,
  runtimes: Map<string, Runtime>,
  killerId: string,
  victimId: string,
  now: number,
): void {
  const victim = state.players.get(victimId);
  const vrt = runtimes.get(victimId);
  if (!victim || !vrt) return;

  if (victim.mode === 'car') {
    const car = state.cars.get(victim.carId);
    if (car) {
      car.driverId = '';
      car.speed = 0;
    }
    victim.carId = '';
  }
  victim.mode = 'dead';
  victim.hp = 0;
  victim.cash = Math.floor(victim.cash * (1 - DEATH_CASH_LOSS));
  victim.cargo = false;
  victim.deliveryTarget = '';
  victim.weapon = '';
  victim.ammo = 0;
  vrt.deaths++;
  vrt.respawnAt = now + RESPAWN_DELAY_MS;

  if (killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    const krt = runtimes.get(killerId);
    if (killer) killer.wantedUntil = now + WANTED_DURATION_MS;
    if (krt) krt.kills++;
  }
}

export function tickRespawn(
  state: GameState,
  runtimes: Map<string, Runtime>,
  map: CityMap,
  now: number,
): void {
  state.players.forEach((p, id) => {
    if (p.mode !== 'dead') return;
    const rt = runtimes.get(id);
    if (!rt || now < rt.respawnAt) return;
    let door: Point = map.hospitalDoor;
    state.apartments.forEach((apt) => {
      if (apt.rentedBy === p.name) door = { x: apt.doorX, z: apt.doorZ };
    });
    p.x = door.x;
    p.z = door.z;
    p.hp = MAX_HP;
    p.mode = 'foot';
    p.wantedUntil = 0;
    p.rotY = 0;
  });
}
