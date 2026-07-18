import { COP_SALARY_INTERVAL_MS, RENT_INTERVAL_MS } from '@mmo/shared';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  rotY: number;
}

export interface Runtime {
  input: InputState;
  lastAttackAt: number;
  lastDamageAt: number;
  arrestProgress: number; // мс, накопленные копом рядом
  respawnAt: number;
  nextSalaryAt: number;
  nextRentAt: number;
  kills: number;
  deaths: number;
}

export function makeRuntime(now: number): Runtime {
  return {
    input: { up: false, down: false, left: false, right: false, sprint: false, rotY: 0 },
    lastAttackAt: 0,
    lastDamageAt: 0,
    arrestProgress: 0,
    respawnAt: 0,
    nextSalaryAt: now + COP_SALARY_INTERVAL_MS,
    nextRentAt: now + RENT_INTERVAL_MS,
    kills: 0,
    deaths: 0,
  };
}
