import { CHAT_COOLDOWN_MS, CHAT_HISTORY_COOLDOWN_MS, COP_SALARY_INTERVAL_MS, RENT_INTERVAL_MS, SMS_COOLDOWN_MS, SMS_HISTORY_COOLDOWN_MS, WRITE_COOLDOWN_MS } from '@mmo/shared';

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
  lastSmsAt: number;
  lastSmsHistAt: number;
  lastSmsThreadAt: number;      // smsThreadReq — отдельный лимит, не конфликтует с smsHistoryReq
  lastTransferHistAt: number;   // transferHistoryReq — свой лимит
  lastWriteAt: number;          // антиспам пишущих эндпоинтов: deposit/withdraw/transfer/smsRead
  lastDamageAt: number;
  arrestProgress: number; // мс, накопленные копом рядом
  respawnAt: number;
  nextSalaryAt: number;
  salaryAnchorX: number; // позиция при прошлой выплате — зарплата только за патруль (сдвиг)
  salaryAnchorZ: number;
  nextRentAt: number;
  kills: number;
  deaths: number;
  nextWanderAt: number; // зомби: когда переслучить направление блуждания
  wanderRotY: number;
  frozen: boolean;      // обрыв: призрак не симулируется/не эксплуатируется в окне реконнекта
  ip: string;           // IP из onAuth (X-Forwarded-For за nginx) — для антифарм-лимита и банов
  playtimeSec: number;  // наигрыш, персистится в players.playtime_sec
  chatViolations: number[]; // ts срабатываний чат-кулдауна (автомут, Task 6)
}

export function makeRuntime(now: number): Runtime {
  return {
    input: { up: false, down: false, left: false, right: false, sprint: false, rotY: 0 },
    lastAttackAt: 0,
    lastChatAt: -CHAT_COOLDOWN_MS, // первое сообщение без антиспам-блокировки
    lastChatHistAt: -CHAT_HISTORY_COOLDOWN_MS, // первый запрос истории — сразу
    lastSmsAt: -SMS_COOLDOWN_MS,
    lastSmsHistAt: -SMS_HISTORY_COOLDOWN_MS,
    lastSmsThreadAt: -SMS_HISTORY_COOLDOWN_MS,
    lastTransferHistAt: -SMS_HISTORY_COOLDOWN_MS,
    lastWriteAt: -WRITE_COOLDOWN_MS, // первый пишущий запрос проходит сразу
    lastDamageAt: 0,
    arrestProgress: 0,
    respawnAt: 0,
    nextSalaryAt: now + COP_SALARY_INTERVAL_MS,
    salaryAnchorX: 0,
    salaryAnchorZ: 0,
    nextRentAt: now + RENT_INTERVAL_MS,
    kills: 0,
    deaths: 0,
    nextWanderAt: 0,
    wanderRotY: 0,
    frozen: false,
    ip: '',
    playtimeSec: 0,
    chatViolations: [],
  };
}
