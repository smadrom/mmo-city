import { CHAT_COOLDOWN_MS, CHAT_HISTORY_COOLDOWN_MS, COP_SALARY_INTERVAL_MS, RENT_INTERVAL_MS } from '@mmo/shared';

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
  lastChatAt: number;
  lastChatHistAt: number;
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
    lastChatAt: -CHAT_COOLDOWN_MS, // первое сообщение без антиспам-блокировки
    lastChatHistAt: -CHAT_HISTORY_COOLDOWN_MS, // первый запрос истории — сразу
    lastDamageAt: 0,
    arrestProgress: 0,
    respawnAt: 0,
    nextSalaryAt: now + COP_SALARY_INTERVAL_MS,
    nextRentAt: now + RENT_INTERVAL_MS,
    kills: 0,
    deaths: 0,
  };
}
