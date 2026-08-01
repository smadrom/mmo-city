import {
  PUNCH_RANGE, PUNCH_DAMAGE, PUNCH_COOLDOWN_MS, MAX_HP,
  DEATH_CASH_LOSS, WANTED_DURATION_MS, RESPAWN_DELAY_MS, BOUNTY_REWARD,
  ZOMBIE_DAMAGE, ZOMBIE_HP, ZOMBIE_RESPAWN_MS,
  WEAPONS, segmentHitsAABB, segmentAABBEnterT, dist2, inAnyAABB,
  type AABB, type CityMap, type Point, type WeaponKind,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';
import { spawnCashDrop, spawnWeaponDrop } from './pickups.js';

export interface Shot {
  from: Point;
  to: Point;
  hit: boolean;
  victim: string; // sessionId цели, '' при промахе
}

export interface Hit { victim: string; damage: number; x: number; z: number }
export interface AttackResult { attacker: string; shot: Shot | null; swing: boolean; hits: Hit[] }
const NO_ATTACK = { shot: null, swing: false, hits: [] as Hit[] };

export function handleAttack(
  state: GameState,
  runtimes: Map<string, Runtime>,
  attackerId: string,
  now: number,
  colliders: AABB[],
  safeZones: AABB[] = [],
  events?: KillEvent[],
): AttackResult {
  const a = state.players.get(attackerId);
  const art = runtimes.get(attackerId);
  if (!a || !art || a.mode !== 'foot') return { ...NO_ATTACK, attacker: attackerId };
  if (inAnyAABB(a.x, a.z, safeZones)) return { ...NO_ATTACK, attacker: attackerId }; // из беззоны не бьём
  const w = a.weapon && Object.hasOwn(WEAPONS, a.weapon) ? WEAPONS[a.weapon as WeaponKind] : null;
  const ranged = w?.ranged === true;
  const range = w ? w.range : PUNCH_RANGE;
  const damage = w ? w.damage : (a.role === 'zombie' ? ZOMBIE_DAMAGE : PUNCH_DAMAGE);
  const cooldownMs = w ? w.cooldownMs : PUNCH_COOLDOWN_MS;
  if (now - art.lastAttackAt < cooldownMs) return { ...NO_ATTACK, attacker: attackerId };
  if (ranged && a.ammo <= 0) return { ...NO_ATTACK, attacker: attackerId };

  const fx = -Math.sin(a.rotY);
  const fz = -Math.cos(a.rotY);
  const minDot = ranged ? 0.98 : 0.3;
  let bestId = '';
  let bestD = range * range;
  state.players.forEach((t, id) => {
    if (id === attackerId) return;
    if (t.mode === 'jail' || t.mode === 'dead') return;
    if (a.role === 'zombie' && t.role === 'zombie') return; // зомби не дерутся между собой
    if (inAnyAABB(t.x, t.z, safeZones)) return; // жертва в беззоне неуязвима
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
      return { attacker: attackerId, shot: { from: { x: a.x, z: a.z }, to: { x: a.x + fx * range * tWall, z: a.z + fz * range * tWall }, hit: false, victim: '' }, swing: false, hits: [] };
    }
    const victim = state.players.get(bestId)!;
    victim.hp -= damage;
    const vrt = runtimes.get(bestId);
    if (vrt) vrt.lastDamageAt = now;
    if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now, events);
    return {
      attacker: attackerId,
      shot: { from: { x: a.x, z: a.z }, to: { x: victim.x, z: victim.z }, hit: true, victim: bestId },
      swing: false,
      hits: [{ victim: bestId, damage, x: victim.x, z: victim.z }],
    };
  }

  if (!bestId) return { ...NO_ATTACK, attacker: attackerId, swing: true };
  const victim = state.players.get(bestId);
  const vrt = runtimes.get(bestId);
  if (!victim || !vrt) return { ...NO_ATTACK, attacker: attackerId, swing: true };
  victim.hp -= damage;
  vrt.lastDamageAt = now;
  if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now, events);
  return { attacker: attackerId, shot: null, swing: true, hits: [{ victim: bestId, damage, x: victim.x, z: victim.z }] };
}

export interface KillEvent { killerId: string; victimId: string; bounty: boolean }

export function killPlayer(
  state: GameState,
  runtimes: Map<string, Runtime>,
  killerId: string,
  victimId: string,
  now: number,
  events?: KillEvent[],
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
  // доля наличных выпадает денежным пикапом на месте смерти (спека: дроп, а не сжигание)
  const drop = Math.floor(victim.cash * DEATH_CASH_LOSS);
  victim.cash -= drop;
  if (drop > 0) spawnCashDrop(state, victim.x, victim.z, drop, `cash-${victimId}-${now}`);
  if (victim.role !== 'zombie' && victim.weapon) {
    // трофей: оружие жертвы падает пикапом — охота за стволами, а не молчаливое сжигание
    spawnWeaponDrop(state, victim.x, victim.z, victim.weapon, `wpn-${victimId}-${now}`);
  }
  if (victim.role === 'zombie' && killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    if (killer && killer.role !== 'zombie') {
      // PvE-фарм кладбища: 10-29$ с зомби, иначе зомби — чистый негатив без награды
      spawnCashDrop(state, victim.x, victim.z, 10 + Math.floor(Math.random() * 20), `zcash-${victimId}-${now}`);
    }
  }
  victim.mode = 'dead';
  victim.hp = 0;
  victim.cargo = false;
  victim.deliveryTarget = '';
  victim.weapon = '';
  victim.ammo = 0;
  vrt.deaths++;
  vrt.respawnAt = now + (victim.role === 'zombie' ? ZOMBIE_RESPAWN_MS : RESPAWN_DELAY_MS);

  if (killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    const krt = runtimes.get(killerId);
    const bounty = !!killer && killer.role !== 'zombie' && victim.role !== 'zombie' && victim.wantedUntil > now;
    if (killer && killer.role !== 'zombie' && victim.role !== 'zombie' && !bounty) {
      killer.wantedUntil = now + WANTED_DURATION_MS; // зомби розыск не получают и за зомби розыска нет
    }
    if (bounty && killer) killer.cash += BOUNTY_REWARD; // праведное убийство: награда вместо розыска
    if (krt) krt.kills++;
    events?.push({ killerId, victimId, bounty });
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
    if (p.role === 'zombie') {
      const s = map.zombieSpawns[Math.floor(Math.random() * map.zombieSpawns.length)];
      p.x = s.x;
      p.z = s.z;
      p.hp = ZOMBIE_HP;
    } else {
      // всегда больница — респаун в безопасной зоне (спека)
      p.x = map.hospitalDoor.x;
      p.z = map.hospitalDoor.z;
      p.hp = MAX_HP;
    }
    p.mode = 'foot';
    p.wantedUntil = 0;
    p.rotY = 0;
  });
}
