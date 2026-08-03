// Игровые константы. Единый источник правды для сервера и клиента.
export const PROTOCOL_VERSION = 5; // хендшейк схемы/сообщений; инкрементить при изменении Player/протокола
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
  pistol: { name: 'Пистолет', price: 600,  damage: 25, range: 40,  cooldownMs: 400, ranged: true  },
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
export const ARREST_BONUS = 150; // арест должен быть выгоден — иначе коп худшая роль
export const BOUNTY_REWARD = 25; // за убийство розыскного; праведное — розыск не даём
export const JAIL_TIME_MS = 2 * 60_000;
export const COP_SALARY = 50;
export const COP_SALARY_INTERVAL_MS = 5 * 60_000;
export const COP_LIMIT = 20;
export const COP_PATROL_MIN_DIST = 30; // м смещения между выплатами — иначе AFK-коп не платится

export const START_CASH = 500;
export const DELIVERY_REWARD_BASE = 60;   // минимум за заказ
export const DELIVERY_REWARD_PER_M = 0.4; // + за метр от склада до точки
export const DELIVERY_TIME_MS = 3 * 60_000;
export const DELIVERY_PICKUP_DIST = 6;
export const DELIVERY_DROP_DIST = 6;
export const JOB_RETRY_COOLDOWN_MS = 30_000; // пауза на новый заказ после отказа/просрочки

export const RENT_PRICE = 100;
export const RENT_INTERVAL_MS = 60 * 60_000;
export const SAFE_LIMIT = 5000;
export const DOOR_DIST = 3;

export const CHAT_MAX_LEN = 120;
export const CHAT_COOLDOWN_MS = 1500;
export const CHAT_HISTORY = 20;
export const CHAT_HISTORY_COOLDOWN_MS = 5000; // chatHistoryReq не чаще раза в 5 сек на клиента

export const MAX_PLAYERS = 100;

export const PICKUP_RESPAWN_MS = 30_000;
export const PICKUP_RADIUS = 1.5;

export const ZOMBIE_COUNT = 20;
export const ZOMBIE_HP = 60;
export const ZOMBIE_SPEED = 4.5; // чуть медленнее шага игрока — убежать можно
export const ZOMBIE_DAMAGE = 10;
export const ZOMBIE_AGGRO_DIST = 25;
export const ZOMBIE_RESPAWN_MS = 5000;

export const RUNOVER_MIN_SPEED = 4; // ниже — толчок без урона
export const RUNOVER_DAMAGE_K = 3; // урон = round(|speed| * K)
export const RUNOVER_KNOCKBACK_K = 0.5; // отброс = |speed| * K, кап 6 м
export const RUNOVER_REPEAT_MS = 500;
export const CAR_CRASH_SPEED_KEEP = 0.3;

export const SMS_MAX_LEN = 140;
export const SMS_COOLDOWN_MS = 1500;
export const SMS_THREAD_LIMIT = 50; // сообщений на диалог за раз
export const SMS_HISTORY_COOLDOWN_MS = 5000; // как у chatHistoryReq

export const TRANSFER_MIN = 1;
export const TRANSFER_MAX = 100_000;
export const TRANSFER_HISTORY = 10;
export const WRITE_COOLDOWN_MS = 500; // антиспам дешёвых пишущих эндпоинтов: банк/переводы/smsRead

export const MINIMAP_SIZE = 200;  // px, диаметр круга
export const MINIMAP_RADIUS = 60; // метров обзора от центра
export const FULLMAP_MAX_ZOOM = 6; // кратность от «весь город влез»

// антимультиаккаунт: переводы после 30 мин наигрыша + суточный лимит по IP
export const TRANSFER_MIN_PLAYTIME_SEC = 1800;
export const TRANSFER_IP_DAILY_LIMIT = 1000; // $ с одного IP за 24 ч

// автомут: N срабатываний чат-кулдауна за окно → мут
export const AUTOMUTE_VIOLATIONS = 5;
export const AUTOMUTE_WINDOW_MS = 60_000;
export const AUTOMUTE_MINUTES = 10;
