// Игровые константы. Единый источник правды для сервера и клиента.
export const TICK_RATE = 20;
export const MAP_HALF = 200; // мир 400x400, координаты от -200 до 200

export const PLAYER_RADIUS = 0.5;
export const PLAYER_SPEED = 5;
export const PLAYER_SPRINT = 8;

export const CAR_RADIUS = 1.5;
export const CAR_MAX_SPEED = 20;
export const CAR_REVERSE_SPEED = 6;
export const CAR_ACCEL = 12;
export const CAR_BRAKE = 25;
export const CAR_DRAG = 6;
export const CAR_TURN_RATE = 1.8;
export const CAR_ENTER_DIST = 6;
export const CAR_PARK_RETURN_MS = 5 * 60_000;

export const WEAPONS = {
  bat:    { name: 'Бита',     price: 150,  damage: 35, range: 2.5, cooldownMs: 800, ranged: false },
  pistol: { name: 'Пистолет', price: 600,  damage: 15, range: 40,  cooldownMs: 400, ranged: true  },
  rifle:  { name: 'Винтовка', price: 2000, damage: 12, range: 80,  cooldownMs: 120, ranged: true  },
} as const;
export type WeaponKind = keyof typeof WEAPONS; // 'bat' | 'pistol' | 'rifle'
export const AMMO_PACK_PRICE = 100;
export const AMMO_PACK_SIZE = 30;
export const AMMO_MAX = 300;

export const PUNCH_RANGE = 2;
export const PUNCH_DAMAGE = 20;
export const PUNCH_COOLDOWN_MS = 1000;
export const MAX_HP = 100;
export const HP_REGEN_PER_SEC = 2;
export const HP_REGEN_DELAY_MS = 5000;
export const RESPAWN_DELAY_MS = 3000;
export const DEATH_CASH_LOSS = 0.5;

export const WANTED_DURATION_MS = 3 * 60_000;
export const ARREST_RANGE = 3;
export const ARREST_TIME_MS = 3000;
export const ARREST_CASH_LOSS = 0.25;
export const ARREST_BONUS = 50;
export const JAIL_TIME_MS = 2 * 60_000;
export const COP_SALARY = 50;
export const COP_SALARY_INTERVAL_MS = 5 * 60_000;
export const COP_LIMIT = 20;

export const START_CASH = 500;
export const DELIVERY_REWARD = 100;
export const DELIVERY_TIME_MS = 3 * 60_000;
export const DELIVERY_PICKUP_DIST = 6;
export const DELIVERY_DROP_DIST = 6;

export const RENT_PRICE = 100;
export const RENT_INTERVAL_MS = 60 * 60_000;
export const SAFE_LIMIT = 5000;
export const DOOR_DIST = 3;

export const MAX_PLAYERS = 100;
