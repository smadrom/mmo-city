import {
  ZOMBIE_COUNT, ZOMBIE_HP, ZOMBIE_AGGRO_DIST, PUNCH_RANGE, PLAYER_RADIUS,
  dist2, inAnyAABB, pointInAABB, type AABB, type CityMap,
} from '@mmo/shared';
import { GameState, Player } from '../schema/GameState.js';
import { makeRuntime, type Runtime } from '../runtime.js';
import { handleAttack, type AttackResult } from './combat.js';

export function spawnZombies(state: GameState, runtimes: Map<string, Runtime>, map: CityMap, now: number): void {
  for (let i = 0; i < ZOMBIE_COUNT; i++) {
    const z = new Player();
    z.name = 'Зомби';
    z.role = 'zombie';
    z.hp = ZOMBIE_HP;
    const s = map.zombieSpawns[i % map.zombieSpawns.length];
    z.x = s.x;
    z.z = s.z;
    state.players.set(`z${i}`, z);
    runtimes.set(`z${i}`, makeRuntime(now));
  }
}

export function tickZombies(
  state: GameState,
  runtimes: Map<string, Runtime>,
  map: CityMap,
  colliders: AABB[],
  now: number,
): AttackResult[] {
  const results: AttackResult[] = [];
  state.players.forEach((z, id) => {
    if (z.role !== 'zombie' || z.mode !== 'foot') return;
    const rt = runtimes.get(id);
    if (!rt) return;

    // зомби не заходит в безопасные зоны: выталкивание по меньшей оси проникновения
    for (const b of map.safeZones) {
      if (!pointInAABB(z.x, z.z, b)) continue;
      const dxl = z.x - (b.x - b.w / 2);
      const dxr = (b.x + b.w / 2) - z.x;
      const dzl = z.z - (b.z - b.d / 2);
      const dzr = (b.z + b.d / 2) - z.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) z.x = b.x - b.w / 2 - PLAYER_RADIUS;
      else if (m === dxr) z.x = b.x + b.w / 2 + PLAYER_RADIUS;
      else if (m === dzl) z.z = b.z - b.d / 2 - PLAYER_RADIUS;
      else z.z = b.z + b.d / 2 + PLAYER_RADIUS;
    }

    // цель: ближайший живой не-зомби пешеход вне беззоны
    let target: Player | null = null;
    let best = ZOMBIE_AGGRO_DIST * ZOMBIE_AGGRO_DIST;
    state.players.forEach((p, pid) => {
      if (p.role === 'zombie' || p.mode !== 'foot') return;
      if (runtimes.get(pid)?.frozen) return; // не агримся на замороженного призрака
      if (inAnyAABB(p.x, p.z, map.safeZones)) return;
      const d2 = dist2(p.x, p.z, z.x, z.z);
      if (d2 < best) {
        best = d2;
        target = p;
      }
    });

    const inp = rt.input;
    if (target) {
      const t: Player = target;
      inp.up = true;
      inp.down = false;
      inp.left = false;
      inp.right = false;
      inp.sprint = false;
      inp.rotY = Math.atan2(-(t.x - z.x), -(t.z - z.z)); // forward = (-sin, -cos)
      z.rotY = inp.rotY; // handleAttack целится по a.rotY — разворачиваем зомби сразу
      if (best <= PUNCH_RANGE * PUNCH_RANGE) {
        const res = handleAttack(state, runtimes, id, now, colliders, map.safeZones);
        if (res.swing || res.hits.length > 0) results.push(res);
      }
    } else {
      // блуждание: раз в 3 сек новое случайное направление
      if (now >= rt.nextWanderAt) {
        rt.nextWanderAt = now + 3000;
        rt.wanderRotY = Math.random() * Math.PI * 2;
      }
      inp.up = true;
      inp.down = false;
      inp.left = false;
      inp.right = false;
      inp.sprint = false;
      inp.rotY = rt.wanderRotY;
    }
  });
  return results;
}
