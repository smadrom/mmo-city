import {
  PLAYER_SPEED, PLAYER_SPRINT, PLAYER_RADIUS, MAP_HALF,
  MAX_HP, HP_REGEN_PER_SEC, HP_REGEN_DELAY_MS,
  moveCircle, clamp, type AABB,
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
    if (!rt) return;

    if (p.mode === 'foot') {
      const inp = rt.input;
      const mf = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
      const mr = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (mf !== 0 || mr !== 0) {
        const fx = -Math.sin(inp.rotY);
        const fz = -Math.cos(inp.rotY);
        const rx = Math.cos(inp.rotY);
        const rz = -Math.sin(inp.rotY);
        const mx = fx * mf + rx * mr;
        const mz = fz * mf + rz * mr;
        const len = Math.hypot(mx, mz);
        const speed = (inp.sprint ? PLAYER_SPRINT : PLAYER_SPEED) * dt / len;
        const res = moveCircle(p.x, p.z, mx * speed, mz * speed, PLAYER_RADIUS, colliders);
        p.x = clamp(res.x, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
        p.z = clamp(res.z, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
      }
      p.rotY = inp.rotY;
    }

    if (p.mode !== 'dead' && p.hp < MAX_HP && now - rt.lastDamageAt > HP_REGEN_DELAY_MS) {
      p.hp = Math.min(MAX_HP, p.hp + HP_REGEN_PER_SEC * dt);
    }
  });
}
