import {
  MAX_HP, HP_REGEN_PER_SEC, HP_REGEN_DELAY_MS,
  ZOMBIE_SPEED, PLAYER_SPEED, ZOMBIE_HP,
  stepFoot, type AABB,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export function tickMovement(
  state: GameState,
  runtimes: Map<string, Runtime>,
  colliders: AABB[],
  dt: number,
  now: number,
): void {
  state.players.forEach((p, id) => {
    const rt = runtimes.get(id);
    if (!rt || rt.frozen) return; // замороженный призрак реконнекта не симулируется (ни движение, ни реген)

    if (p.mode === 'foot') {
      // математика шага общая с клиентским предсказанием (stepFoot из shared)
      const res = stepFoot(p.x, p.z, rt.input, dt, colliders, p.role === 'zombie' ? ZOMBIE_SPEED : PLAYER_SPEED);
      p.x = res.x;
      p.z = res.z;
      p.rotY = rt.input.rotY;
    }

    const maxHp = p.role === 'zombie' ? ZOMBIE_HP : MAX_HP;
    if (p.mode !== 'dead' && p.hp < maxHp && now - rt.lastDamageAt > HP_REGEN_DELAY_MS) {
      p.hp = Math.min(maxHp, p.hp + HP_REGEN_PER_SEC * dt);
    }
  });
}
