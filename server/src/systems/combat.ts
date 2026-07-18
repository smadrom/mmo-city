import {
  PUNCH_RANGE, PUNCH_DAMAGE, PUNCH_COOLDOWN_MS, MAX_HP,
  DEATH_CASH_LOSS, WANTED_DURATION_MS, RESPAWN_DELAY_MS,
  dist2, type CityMap, type Point,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export function handleAttack(
  state: GameState,
  runtimes: Map<string, Runtime>,
  attackerId: string,
  now: number,
): void {
  const a = state.players.get(attackerId);
  const art = runtimes.get(attackerId);
  if (!a || !art || a.mode !== 'foot') return;
  if (now - art.lastAttackAt < PUNCH_COOLDOWN_MS) return;

  const fx = -Math.sin(a.rotY);
  const fz = -Math.cos(a.rotY);
  let bestId = '';
  let bestD = PUNCH_RANGE * PUNCH_RANGE;
  state.players.forEach((t, id) => {
    if (id === attackerId) return;
    if (t.mode === 'jail' || t.mode === 'dead') return;
    const d2 = dist2(a.x, a.z, t.x, t.z);
    if (d2 > bestD || d2 === 0) return;
    const len = Math.sqrt(d2);
    const dot = ((t.x - a.x) / len) * fx + ((t.z - a.z) / len) * fz;
    if (dot < 0.3) return;
    bestId = id;
    bestD = d2;
  });
  art.lastAttackAt = now;
  if (!bestId) return;

  const victim = state.players.get(bestId);
  const vrt = runtimes.get(bestId);
  if (!victim || !vrt) return;
  victim.hp -= PUNCH_DAMAGE;
  vrt.lastDamageAt = now;
  if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
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
