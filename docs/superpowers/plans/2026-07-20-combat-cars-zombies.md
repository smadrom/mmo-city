# Этап «Бой, машины и зомби» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Читаемый бой (цифры урона, HP-полоски, анимации, прицел по ПКМ), живая техника (руль/колёса, наезд, таран, разворот на границе зоны), пикапы с респауном, серверные зомби, безопасные зоны, GTA-маркеры, дроп денег, фиксы диалогов и баннеров.

**Architecture:** Сервер авторитетен. Новые знания клиенту: broadcast-события (`hit`, `swing` — по модели существующего `shot`) и схема (`Car.steer`, `state.pickups`, зомби как `Player` с `role='zombie'`). Зомби переиспользуют общие системы (`tickMovement`, `handleAttack`, `tickRespawn`). Клиент — только визуал.

**Tech Stack:** TypeScript, Colyseus 0.16, Three.js, Vitest.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-07-20-combat-cars-zombies-design.md` — сверяться по числам и правилам.
- TDD: серверный код — только с упавшим тестом сначала. Запуск одного файла: `npx vitest run --root server test/<file>.ts` (или `--root shared` для shared).
- Клиентских автотестов нет — верификация клиента: `npm run build -w client` (tsc + vite) зелёный.
- Коммит в конце каждой таски. Русские сообщения коммитов, как в истории.
- Схема меняется (`Car.steer`, `Pickup`, `role='zombie'`) — деплой потом только клиент+сервер вместе.
- Локальный dev-сервер запущен в фоне — Vite подхватит правки, серверные правки требуют его перезапуска (делает исполнитель в финале).

---

### Task 1: Shared — константы, геометрия зон, скорость в stepFoot, новые точки карты

**Files:**
- Modify: `shared/src/config.ts`
- Modify: `shared/src/physics.ts`
- Modify: `shared/src/map.ts`
- Test: `shared/test/physics.test.ts`, `shared/test/map.test.ts`

**Interfaces:**
- Produces: константы `PICKUP_*`, `ZOMBIE_*`, `RUNOVER_*`, `CAR_CRASH_SPEED_KEEP`; `pointInAABB(x, z, b: AABB): boolean`, `inAnyAABB(x, z, boxes: AABB[]): boolean`; `stepFoot(x, z, inp, dt, colliders, speedWalk = PLAYER_SPEED)`; `CityMap.safeZones/zombieSpawns/pickupSpots`, `TARGET_LABELS`.

- [ ] **Step 1: Падающие тесты physics**

Добавить в `shared/test/physics.test.ts` (импорт дополнить `pointInAABB, inAnyAABB`):

```ts
describe('pointInAABB / inAnyAABB', () => {
  const zone = { x: 0, z: 0, w: 10, d: 20 }; // x: -5..5, z: -10..10
  it('точка внутри и снаружи', () => {
    expect(pointInAABB(5, 10, zone)).toBe(true);
    expect(pointInAABB(5.1, 0, zone)).toBe(false);
    expect(inAnyAABB(0, 0, [zone])).toBe(true);
    expect(inAnyAABB(100, 0, [zone])).toBe(false);
  });
});

// в describe('stepFoot'):
  it('кастомная скорость шага (зомби медленнее игрока)', () => {
    const r = stepFoot(0, 0, { ...noKeys, up: true }, dt, [], 4.5);
    expect(r.z).toBeCloseTo(-4.5 * dt, 10);
  });
```

- [ ] **Step 2: Падающие тесты map**

Добавить в `shared/test/map.test.ts` (импорт дополнить `inAnyAABB` из `../src/physics.js`):

```ts
  it('двери больницы и полиции — внутри безопасных зон', () => {
    expect(inAnyAABB(map.hospitalDoor.x, map.hospitalDoor.z, map.safeZones)).toBe(true);
    expect(inAnyAABB(map.policeDoor.x, map.policeDoor.z, map.safeZones)).toBe(true);
  });

  it('точки спавна зомби и пикапов не в зданиях и в границах мира', () => {
    for (const p of [...map.zombieSpawns, ...map.pickupSpots]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(MAP_HALF - 1);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(MAP_HALF - 1);
      for (const b of map.buildings) expect(collidesCircleAABB(p.x, p.z, 1, b)).toBe(false);
    }
  });

  it('10 пикапов, все вне безопасных зон', () => {
    expect(map.pickupSpots).toHaveLength(10);
    for (const p of map.pickupSpots) expect(inAnyAABB(p.x, p.z, map.safeZones)).toBe(false);
  });
```

- [ ] **Step 3: Запустить, увидеть падение**

Run: `npx vitest run --root shared`
Expected: FAIL — `pointInAABB is not a function`, `map.safeZones` undefined и т.п.

- [ ] **Step 4: Константы в config.ts**

Добавить в конец `shared/src/config.ts`:

```ts
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
```

- [ ] **Step 5: physics.ts — pointInAABB, inAnyAABB, скорость в stepFoot**

После `collidesAny` добавить:

```ts
export function pointInAABB(x: number, z: number, b: AABB): boolean {
  return x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2;
}

export function inAnyAABB(x: number, z: number, boxes: AABB[]): boolean {
  return boxes.some(b => pointInAABB(x, z, b));
}
```

В `stepFoot` сигнатуру добавить параметр и использовать в скорости:

```ts
export function stepFoot(
  x: number, z: number, inp: MoveInput, dt: number, colliders: AABB[],
  speedWalk = PLAYER_SPEED,
): { x: number; z: number } {
```

строку скорости заменить на:

```ts
  const speed = (inp.sprint ? PLAYER_SPRINT : speedWalk) * dt / len;
```

- [ ] **Step 6: map.ts — safeZones, zombieSpawns, pickupSpots, TARGET_LABELS**

Импорт в начале: `import type { AABB } from './physics.js';`

В `CityMap` добавить поля:

```ts
  safeZones: AABB[];
  zombieSpawns: Point[];
  pickupSpots: Point[];
```

После интерфейсов добавить:

```ts
export const TARGET_LABELS: Record<string, string> = { shop: 'Магазин', gas: 'Заправка', port: 'Порт' };
```

В return `createCityMap` добавить:

```ts
    safeZones: [
      { x: -150, z: -120, w: 50, d: 30 }, // двор больницы (z: -135..-105, дверь -133 внутри)
      { x: 150, z: -120, w: 50, d: 30 },  // двор полиции
    ],
    zombieSpawns: [
      { x: 180, z: 180 }, { x: -180, z: 180 }, { x: 180, z: -60 },
      { x: -180, z: -60 }, { x: 60, z: 180 }, { x: -60, z: -180 },
    ],
    pickupSpots: [
      { x: -150, z: -100 }, { x: 150, z: -100 }, { x: -100, z: 50 },
      { x: 25, z: -50 }, { x: 100, z: -140 }, { x: -100, z: -140 },
      { x: 50, z: 100 }, { x: 0, z: -20 }, { x: 170, z: 170 }, { x: -50, z: 0 },
    ],
```

- [ ] **Step 7: Запустить, увидеть зелень**

Run: `npx vitest run --root shared`
Expected: все тесты PASS (12 старых + новые).

- [ ] **Step 8: Commit**

```bash
git add shared/
git commit -m "feat(shared): константы этапа, pointInAABB/inAnyAABB, скорость в stepFoot, зоны и точки карты"
```

---

### Task 2: Схема — Car.steer, Pickup, role 'zombie'

**Files:**
- Modify: `server/src/schema/GameState.ts`
- Test: `server/test/schema.test.ts`

**Interfaces:**
- Produces: `Car.steer: number`; `Pickup { id, kind, x, z, active, amount }`; `state.pickups: MapSchema<Pickup>`; `Player.role: 'citizen' | 'cop' | 'zombie'`.

- [ ] **Step 1: Падающие тесты**

В `server/test/schema.test.ts` добавить в `describe('Car schema')`:

```ts
    expect(c.steer).toBe(0);
```

и новые блоки:

```ts
describe('Pickup schema', () => {
  it('has expected defaults', () => {
    const p = new Pickup();
    expect(p.id).toBe('');
    expect(p.kind).toBe('');
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
    expect(p.active).toBe(true);
    expect(p.amount).toBe(0);
  });
});
```

В `describe('GameState schema')` в тест «has map collections and serverTime» добавить:

```ts
    expect(s.pickups).toBeInstanceOf(MapSchema);
```

Импорт дополнить `Pickup`: `import { GameState, Player, Car, Apartment, Pickup } from '../src/schema/GameState.js';`

- [ ] **Step 2: Запустить, увидеть падение**

Run: `npx vitest run --root server test/schema.test.ts`
Expected: FAIL — `Pickup is not defined` / `c.steer` undefined.

- [ ] **Step 3: Реализация схемы**

В `server/src/schema/GameState.ts`:

роль Player: `@type('string') role: 'citizen' | 'cop' | 'zombie' = 'citizen';`

в Car после `speed`: `@type('number') steer = 0;`

после класса Apartment добавить:

```ts
export class Pickup extends Schema {
  @type('string') id = '';
  @type('string') kind = '';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('boolean') active = true;
  @type('number') amount = 0; // только kind='cash'
}
```

в GameState после apartments: `@type({ map: Pickup }) pickups = new MapSchema<Pickup>();`

- [ ] **Step 4: Запустить, увидеть зелень**

Run: `npx vitest run --root server test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/schema/GameState.ts server/test/schema.test.ts
git commit -m "feat(server): схема — Car.steer, Pickup, role zombie"
```

---

### Task 3: Пикапы — система spawnPickups/tickPickups/spawnCashDrop

**Files:**
- Create: `server/src/systems/pickups.ts`
- Test: `server/test/pickups.test.ts`

**Interfaces:**
- Consumes: `Pickup` из схемы (Task 2), `PICKUP_*`, `AMMO_*`, `WEAPONS` из shared (Task 1).
- Produces: `PickupRuntime { respawnAt: number }`; `spawnPickups(state, map, runtimes: Map<string, PickupRuntime>): void`; `spawnCashDrop(state, x, z, amount, id): void`; `tickPickups(state, runtimes, now): void`. Используется в Task 4 (cash drop) и Task 7 (комната).

- [ ] **Step 1: Падающие тесты**

Создать `server/test/pickups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { spawnPickups, tickPickups, spawnCashDrop, type PickupRuntime } from '../src/systems/pickups.js';
import { AMMO_MAX, AMMO_PACK_SIZE, PICKUP_RESPAWN_MS, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const runtimes = new Map<string, PickupRuntime>();
  spawnPickups(state, map, runtimes);
  const p = new Player();
  p.name = 'picker';
  state.players.set('s1', p);
  return { state, p, runtimes };
}

describe('пикапы', () => {
  it('спавн: пикап на каждой точке, вид из 4 не-денежных', () => {
    const { state } = setup();
    expect(state.pickups.size).toBe(map.pickupSpots.length);
    state.pickups.forEach((pk) => {
      expect(['bat', 'pistol', 'rifle', 'ammo']).toContain(pk.kind);
      expect(pk.active).toBe(true);
    });
  });

  it('подбор биты: оружие заменено, пикап деактивирован', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'bat';
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('bat');
    expect(pk.active).toBe(false);
  });

  it('подбор пистолета даёт +30 патронов, кап AMMO_MAX', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'pistol';
    p.ammo = AMMO_MAX - 5;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('pistol');
    expect(p.ammo).toBe(AMMO_MAX);
  });

  it('патроны: +AMMO_PACK_SIZE с капом', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'ammo';
    p.ammo = 10;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.ammo).toBe(10 + AMMO_PACK_SIZE);
  });

  it('денежный дроп: начисляет сумму и удаляется без респауна', () => {
    const { state, p, runtimes } = setup();
    spawnCashDrop(state, 10, 10, 250, 'cash-v-1');
    p.x = 10; p.z = 10;
    p.cash = 100;
    tickPickups(state, runtimes, 1000);
    expect(p.cash).toBe(350);
    expect(state.pickups.has('cash-v-1')).toBe(false);
  });

  it('респаун регулярного пикапа через PICKUP_RESPAWN_MS со сменой вида (из 4)', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(pk.active).toBe(false);
    p.x = 999; p.z = 999; // ушёл
    tickPickups(state, runtimes, 1000 + PICKUP_RESPAWN_MS + 1);
    expect(pk.active).toBe(true);
    expect(['bat', 'pistol', 'rifle', 'ammo']).toContain(pk.kind);
  });

  it('зомби и водитель не подбирают', () => {
    const { state, p, runtimes } = setup();
    const pk = state.pickups.get('pk0')!;
    pk.kind = 'bat';
    p.role = 'zombie';
    p.x = pk.x; p.z = pk.z;
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('');
    expect(pk.active).toBe(true);
    p.role = 'citizen';
    p.mode = 'car';
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('');
    expect(pk.active).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить, увидеть падение**

Run: `npx vitest run --root server test/pickups.test.ts`
Expected: FAIL — модуль `pickups.js` не найден.

- [ ] **Step 3: Реализация**

Создать `server/src/systems/pickups.ts`:

```ts
import {
  WEAPONS, AMMO_PACK_SIZE, AMMO_MAX, PICKUP_RESPAWN_MS, PICKUP_RADIUS,
  dist2, type CityMap, type WeaponKind,
} from '@mmo/shared';
import { GameState, Pickup } from '../schema/GameState.js';

export interface PickupRuntime { respawnAt: number }

const REGULAR_KINDS = ['bat', 'pistol', 'rifle', 'ammo'] as const;

function randomKind(): string {
  return REGULAR_KINDS[Math.floor(Math.random() * REGULAR_KINDS.length)];
}

export function spawnPickups(state: GameState, map: CityMap, runtimes: Map<string, PickupRuntime>): void {
  map.pickupSpots.forEach((s, i) => {
    const pk = new Pickup();
    pk.id = `pk${i}`;
    pk.kind = randomKind();
    pk.x = s.x;
    pk.z = s.z;
    state.pickups.set(pk.id, pk);
    runtimes.set(pk.id, { respawnAt: 0 });
  });
}

// денежный дроп при убийстве: без runtime-записи — не респаунится, удаляется при подборе
export function spawnCashDrop(state: GameState, x: number, z: number, amount: number, id: string): void {
  const pk = new Pickup();
  pk.id = id;
  pk.kind = 'cash';
  pk.x = x;
  pk.z = z;
  pk.amount = amount;
  state.pickups.set(id, pk);
}

export function tickPickups(state: GameState, runtimes: Map<string, PickupRuntime>, now: number): void {
  state.pickups.forEach((pk, id) => {
    if (!pk.active) {
      const rt = runtimes.get(id);
      if (rt && now >= rt.respawnAt) {
        pk.kind = randomKind();
        pk.active = true;
      }
      return;
    }
    state.players.forEach((p) => {
      if (!pk.active) return;
      if (p.mode !== 'foot' || p.role === 'zombie') return;
      if (dist2(p.x, p.z, pk.x, pk.z) > PICKUP_RADIUS * PICKUP_RADIUS) return;
      if (pk.kind === 'cash') {
        p.cash += pk.amount;
        pk.active = false; // защита от двойного подбора в один тик
        state.pickups.delete(id);
        return;
      }
      if (pk.kind === 'ammo') {
        p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
      } else {
        p.weapon = pk.kind; // замена без возврата, как покупка
        if (WEAPONS[pk.kind as WeaponKind].ranged) {
          p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
        }
      }
      pk.active = false;
      const rt = runtimes.get(id);
      if (rt) rt.respawnAt = now + PICKUP_RESPAWN_MS;
    });
  });
}
```

- [ ] **Step 4: Запустить, увидеть зелень**

Run: `npx vitest run --root server test/pickups.test.ts`
Expected: 7 тестов PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/systems/pickups.ts server/test/pickups.test.ts
git commit -m "feat(server): пикапы — спавн, подбор касанием, респаун, денежный дроп"
```

---

### Task 4: Бой — AttackResult (swing/hits), безопасные зоны, зомби-правила, дроп денег, респаун у больницы

**Files:**
- Modify: `server/src/systems/combat.ts`
- Test: `server/test/combat.test.ts` (новые + правка 4 существующих)

**Interfaces:**
- Consumes: `spawnCashDrop` (Task 3), `inAnyAABB`, `ZOMBIE_*` (Task 1).
- Produces: `Hit { victim: string; damage: number; x: number; z: number }`; `AttackResult { attacker: string; shot: Shot | null; swing: boolean; hits: Hit[] }`; `handleAttack(state, runtimes, attackerId, now, colliders, safeZones = []): AttackResult`. Используется в Task 6 (зомби) и Task 7 (комната). `handleAttack` больше НЕ возвращает `Shot | null`.

- [ ] **Step 1: Падающие тесты (новые)**

Добавить в `server/test/combat.test.ts` (импорт дополнить `ZOMBIE_DAMAGE, ZOMBIE_HP, ZOMBIE_RESPAWN_MS`):

```ts
  it('промах кулаком: swing=true, hits пуст', () => {
    const { state, runtimes } = setup();
    state.players.delete('v');
    const res = handleAttack(state, runtimes, 'a', 1000, []);
    expect(res.swing).toBe(true);
    expect(res.hits).toHaveLength(0);
    expect(res.attacker).toBe('a');
  });

  it('попадание: hits с уроном и координатами жертвы', () => {
    const { state, runtimes } = setup();
    const res = handleAttack(state, runtimes, 'a', 1000, []);
    expect(res.hits).toEqual([{ victim: 'v', damage: PUNCH_DAMAGE, x: 0, z: -1.5 }]);
  });

  it('жертва в безопасной зоне неуязвима (melee и ranged)', () => {
    const { state, a, v, runtimes } = setup();
    const zones = [{ x: 0, z: -1.5, w: 10, d: 10 }];
    let res = handleAttack(state, runtimes, 'a', 1000, [], zones);
    expect(v.hp).toBe(MAX_HP);
    expect(res.hits).toHaveLength(0);
    a.weapon = 'pistol'; a.ammo = 5; v.z = -20;
    res = handleAttack(state, runtimes, 'a', 3000, [], zones);
    expect(v.hp).toBe(MAX_HP);
    expect(res.shot?.hit).toBe(false);
  });

  it('атакующий в безопасной зоне не бьёт наружу', () => {
    const { state, runtimes } = setup();
    const zones = [{ x: 0, z: 0, w: 4, d: 4 }]; // атакующий внутри
    const res = handleAttack(state, runtimes, 'a', 1000, [], zones);
    expect(res.swing).toBe(false);
    expect(res.hits).toHaveLength(0);
  });

  it('зомби бьёт ZOMBIE_DAMAGE и не трогает других зомби', () => {
    const { state, a, v, runtimes } = setup();
    a.role = 'zombie';
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.hp).toBe(MAX_HP - ZOMBIE_DAMAGE);
    v.role = 'zombie';
    const res = handleAttack(state, runtimes, 'a', 3000, []);
    expect(res.hits).toHaveLength(0);
  });

  it('убийство зомби: kills растёт, розыска нет', () => {
    const { state, a, v, runtimes } = setup();
    v.role = 'zombie';
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.mode).toBe('dead');
    expect(a.wantedUntil).toBe(0);
    expect(runtimes.get('a')!.kills).toBe(1);
  });

  it('при убийстве доля наличных выпадает пикапом cash на месте смерти', () => {
    const { state, v, runtimes } = setup();
    v.cash = 400;
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    expect(v.cash).toBe(200);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'cash');
    expect(drops).toHaveLength(1);
    expect(drops[0].amount).toBe(200);
    expect(drops[0].x).toBe(0);
    expect(drops[0].z).toBe(-1.5);
  });

  it('респаун всегда у больницы, даже с квартирой', () => {
    const { state, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.apt = 'apt1'; // раньше респаунило у своей двери
    handleAttack(state, runtimes, 'a', 1000, []);
    const map = createCityMap();
    tickRespawn(state, runtimes, map, 1000 + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.x).toBe(map.hospitalDoor.x);
    expect(v.z).toBe(map.hospitalDoor.z);
  });

  it('зомби воскресает на zombieSpawns с ZOMBIE_HP после ZOMBIE_RESPAWN_MS', () => {
    const { state, v, runtimes } = setup();
    v.role = 'zombie';
    v.hp = PUNCH_DAMAGE;
    handleAttack(state, runtimes, 'a', 1000, []);
    const map = createCityMap();
    tickRespawn(state, runtimes, map, 1000 + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('dead'); // рано
    tickRespawn(state, runtimes, map, 1000 + ZOMBIE_RESPAWN_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.hp).toBe(ZOMBIE_HP);
    const onSpawn = map.zombieSpawns.some(s => s.x === v.x && s.z === v.z);
    expect(onSpawn).toBe(true);
  });
```

- [ ] **Step 2: Правка существующих тестов под новый контракт**

`handleAttack` теперь возвращает `AttackResult`. В `server/test/combat.test.ts`:

- тест «пистолет без патронов не стреляет»: `const shot = handleAttack(...)` → `const shot = handleAttack(...).shot;` (ожидание `toBeNull()` сохраняется);
- тест «пистолет: попадание…»: `const shot = handleAttack(...)` → `const shot = handleAttack(...).shot;`
- тест «промах тратит патрон…`: то же `.shot`;
- тест «стена блокирует выстрел…»: то же `.shot`.

- [ ] **Step 3: Запустить, увидеть падение**

Run: `npx vitest run --root server test/combat.test.ts`
Expected: FAIL — новые тесты падают (нет `swing`/`hits`/дропа), старые с `.shot` — `handleAttack(...).shot` undefined у `Shot`.

- [ ] **Step 4: Реализация combat.ts**

В `server/src/systems/combat.ts`:

Импорт дополнить: `inAnyAABB, ZOMBIE_DAMAGE, ZOMBIE_HP, ZOMBIE_RESPAWN_MS` из '@mmo/shared' и `import { spawnCashDrop } from './pickups.js';`

После интерфейса `Shot` добавить:

```ts
export interface Hit { victim: string; damage: number; x: number; z: number }
export interface AttackResult { attacker: string; shot: Shot | null; swing: boolean; hits: Hit[] }
const NO_ATTACK = { shot: null, swing: false, hits: [] as Hit[] };
```

`handleAttack` переписать целиком:

```ts
export function handleAttack(
  state: GameState,
  runtimes: Map<string, Runtime>,
  attackerId: string,
  now: number,
  colliders: AABB[],
  safeZones: AABB[] = [],
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
    if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
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
  if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
  return { attacker: attackerId, shot: null, swing: true, hits: [{ victim: bestId, damage, x: victim.x, z: victim.z }] };
}
```

В `killPlayer` заменить блок потери наличных и респаун-таймер, и правило розыска:

```ts
  // доля наличных выпадает денежным пикапом на месте смерти (спека: дроп, а не сжигание)
  const drop = Math.floor(victim.cash * DEATH_CASH_LOSS);
  victim.cash -= drop;
  if (drop > 0) spawnCashDrop(state, victim.x, victim.z, drop, `cash-${victimId}-${now}`);
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
    if (killer && victim.role !== 'zombie') killer.wantedUntil = now + WANTED_DURATION_MS; // за зомби розыска нет
    if (krt) krt.kills++;
  }
```

(старые строки `victim.cash = Math.floor(...)` и выход из машины — удалить потерю cash, остальное поведение killPlayer сохранить: выход из машины остаётся).

`tickRespawn` переписать цикл:

```ts
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
```

(импорт `Point` и ветку квартиры убрать за ненадобностью).

- [ ] **Step 5: Запустить, увидеть зелень**

Run: `npx vitest run --root server test/combat.test.ts`
Expected: все тесты PASS (старые + новые).

- [ ] **Step 6: Commit**

```bash
git add server/src/systems/combat.ts server/test/combat.test.ts
git commit -m "feat(server): AttackResult (swing/hits), беззоны в бою, зомби-правила, дроп денег, респаун у больницы"
```

---

### Task 5: Машины — steer в схему, наезд, таран, разворот на границе зоны

**Files:**
- Modify: `server/src/systems/vehicles.ts`
- Test: `server/test/vehicles.test.ts`

**Interfaces:**
- Consumes: `Hit`, `killPlayer` (Task 4), `RUNOVER_*`, `CAR_CRASH_SPEED_KEEP`, `inAnyAABB`, `moveCircle`, `PLAYER_RADIUS` (Task 1).
- Produces: `tickVehicles(state, runtimes, carRuntime, colliders, dt, now, parkingSpots, safeZones = []): Hit[]`. Старые вызовы без `safeZones` валидны (дефолт `[]`), возврат можно игнорировать.

- [ ] **Step 1: Падающие тесты**

Добавить в `server/test/vehicles.test.ts` (импорт дополнить `MAX_HP, RUNOVER_DAMAGE_K, WANTED_DURATION_MS, CAR_CRASH_SPEED_KEEP, pointInAABB`):

```ts
  it('steer пишется в схему: left = 1, без ввода 0', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.up = true;
    runtimes.get('s1')!.input.left = true;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 0, spots);
    expect(car.steer).toBe(1);
    runtimes.get('s1')!.input.left = false;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 50, spots);
    expect(car.steer).toBe(0);
  });

  it('наезд: урон по скорости, hit-событие, жертву отбрасывает', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    v.name = 'ped';
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1; // в контакте (радиус 2.0)
    const v0 = { x: v.x, z: v.z };
    car.speed = 20; // тик сам погасит до 19.7 — всё равно > RUNOVER_MIN_SPEED
    const hits = tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(hits).toHaveLength(1);
    expect(hits[0].victim).toBe('v');
    expect(hits[0].damage).toBeGreaterThan(0);
    expect(v.hp).toBe(MAX_HP - hits[0].damage);
    expect(Math.hypot(v.x - v0.x, v.z - v0.z)).toBeGreaterThan(0.5); // отброшена
  });

  it('наезд насмерть на зомби: без розыска водителю', () => {
    const { state, p, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const z = new Player();
    z.name = 'Зомби'; z.role = 'zombie'; z.hp = 5;
    state.players.set('z0', z);
    runtimes.set('z0', makeRuntime(0));
    z.x = car.x + 0.5; z.z = car.z - 1;
    car.speed = 20;
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(z.mode).toBe('dead');
    expect(p.wantedUntil).toBe(0); // зомби — не преступление
  });

  it('медленный контакт: только толчок, без урона', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1;
    const v0 = { x: v.x, z: v.z };
    car.speed = 3; // < RUNOVER_MIN_SPEED
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(v.hp).toBe(MAX_HP);
    expect(Math.hypot(v.x - v0.x, v.z - v0.z)).toBeGreaterThan(0.1); // оттолкнула
  });

  it('повторный урон той же жертве не чаще раза в 500 мс', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const v = new Player();
    state.players.set('v', v);
    runtimes.set('v', makeRuntime(0));
    v.x = car.x + 0.5; v.z = car.z - 1;
    runtimes.get('v')!.lastDamageAt = 4900; // «только что» уже получал урон
    car.speed = 20;
    const hits = tickVehicles(state, runtimes, carRuntime, [], 0.05, 5000, spots);
    expect(hits).toHaveLength(0); // кулдаун 500 мс не прошёл
    expect(v.hp).toBe(MAX_HP);
  });

  it('таран: машины разъезжаются, скорости гаснут', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    car.speed = 10;
    const b = new Car();
    b.id = 'car1'; b.x = car.x + 1; b.z = car.z; b.speed = -4; // перекрытие 1 м
    state.cars.set('car1', b);
    carRuntime.set('car1', { emptySince: 0 });
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000, spots);
    const d = Math.hypot(b.x - car.x, b.z - car.z);
    expect(d).toBeGreaterThanOrEqual(3 - 1e-9); // 2 * CAR_RADIUS
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(10 * CAR_CRASH_SPEED_KEEP + 1e-9);
    expect(Math.abs(b.speed)).toBeLessThanOrEqual(4 * CAR_CRASH_SPEED_KEEP + 1e-9);
  });

  it('въезд в безопасную зону: разворот на PI, остановка, снаружи', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const zone = { x: 5, z: -20, w: 30, d: 20 }; // z: -30..-10, машина на (5,0) едет в -z
    runtimes.get('s1')!.input.up = true;
    const rotBefore = car.rotY;
    let flipped = false;
    for (let i = 0; i < 60 && !flipped; i++) {
      tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots, [zone]);
      if (Math.abs(car.rotY - rotBefore) > 1) flipped = true; // поймали тик разворота
    }
    expect(flipped).toBe(true);
    expect(pointInAABB(car.x, car.z, zone)).toBe(false);
    expect(car.speed).toBe(0);
    expect(Math.abs((car.rotY - rotBefore) % (Math.PI * 2))).toBeCloseTo(Math.PI, 1);
  });
```

(импорты `Player`, `makeRuntime`, `type Runtime` в файле уже есть от setup; `RUNOVER_DAMAGE_K, CAR_CRASH_SPEED_KEEP, MAX_HP, WANTED_DURATION_MS, pointInAABB` добавить в импорт из '@mmo/shared'.)

- [ ] **Step 2: Запустить, увидеть падение**

Run: `npx vitest run --root server test/vehicles.test.ts`
Expected: FAIL — нет `steer`/наезда/таranа/разворота; `pointInAABB` может быть не импортирован.

- [ ] **Step 3: Реализация vehicles.ts**

Импорт в `server/src/systems/vehicles.ts` дополнить:

```ts
import {
  CAR_RADIUS, CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG, CAR_TURN_RATE,
  CAR_ENTER_DIST, CAR_PARK_RETURN_MS, MAP_HALF, PLAYER_RADIUS,
  RUNOVER_MIN_SPEED, RUNOVER_DAMAGE_K, RUNOVER_KNOCKBACK_K, RUNOVER_REPEAT_MS, CAR_CRASH_SPEED_KEEP,
  collidesAny, clamp, dist2, moveCircle, inAnyAABB, type AABB, type ParkingSpot,
} from '@mmo/shared';
import { killPlayer, type Hit } from './combat.js';
```

Сигнатуру `tickVehicles` дополнить `safeZones: AABB[] = []` и возвратом `Hit[]`; в начале тела: `const hits: Hit[] = [];`

В ветке водителя после вычисления `steer` добавить `car.steer = steer;`, в ветке без водителя — `car.steer = 0;`.

Блок движения заменить (добавляется проверка беззоны с разворотом):

```ts
      if (car.speed !== 0) {
        const nx = clamp(car.x - Math.sin(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        const nz = clamp(car.z - Math.cos(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        if (collidesAny(nx, nz, CAR_RADIUS, colliders)) {
          car.speed = 0;
        } else if (inAnyAABB(nx, nz, safeZones)) {
          // граница безопасной зоны разворачивает (как в GTA SA)
          car.speed = 0;
          car.rotY += Math.PI;
        } else {
          car.x = nx;
          car.z = nz;
        }
      }
      driver.x = car.x;
      driver.z = car.z;
      driver.rotY = car.rotY;

      // наезд: пешеходы (включая зомби) в радиусе контакта, вне беззон
      const sp = Math.abs(car.speed);
      if (sp > 0) {
        state.players.forEach((v, vid) => {
          if (vid === car.driverId || v.mode !== 'foot') return;
          if (inAnyAABB(v.x, v.z, safeZones)) return;
          const R = CAR_RADIUS + PLAYER_RADIUS;
          const d2 = dist2(v.x, v.z, car.x, car.z);
          if (d2 > R * R || d2 === 0) return;
          const len = Math.sqrt(d2);
          const kb = Math.min(6, sp * RUNOVER_KNOCKBACK_K) * (sp > RUNOVER_MIN_SPEED ? 1 : 0.5);
          const res = moveCircle(v.x, v.z, ((v.x - car.x) / len) * kb, ((v.z - car.z) / len) * kb, PLAYER_RADIUS, colliders);
          v.x = clamp(res.x, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
          v.z = clamp(res.z, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
          if (sp <= RUNOVER_MIN_SPEED) return; // медленный контакт — только толчок
          const vrt = runtimes.get(vid);
          if (!vrt || now - vrt.lastDamageAt < RUNOVER_REPEAT_MS) return;
          const damage = Math.round(sp * RUNOVER_DAMAGE_K);
          v.hp -= damage;
          vrt.lastDamageAt = now;
          hits.push({ victim: vid, damage, x: v.x, z: v.z });
          if (v.hp <= 0) killPlayer(state, runtimes, car.driverId, vid, now);
        });
      }
```

Таран — перед `return hits;` в конце функции:

```ts
  // таран: развести перекрывшиеся машины, погасить скорости
  const cars = [...state.cars.values()];
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i];
      const B = cars[j];
      const d2 = dist2(A.x, A.z, B.x, B.z);
      const R = CAR_RADIUS * 2;
      if (d2 >= R * R || d2 === 0) continue;
      const len = Math.sqrt(d2);
      const overlap = (R - len) / 2;
      const ux = (B.x - A.x) / len;
      const uz = (B.z - A.z) / len;
      A.x = clamp(A.x - ux * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      A.z = clamp(A.z - uz * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      B.x = clamp(B.x + ux * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      B.z = clamp(B.z + uz * overlap, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
      A.speed *= CAR_CRASH_SPEED_KEEP;
      B.speed *= CAR_CRASH_SPEED_KEEP;
    }
  }
  return hits;
```

(и закрывающую скобку `});` forEach по машинам оставить перед блоком тарана.)

- [ ] **Step 4: Запустить, увидеть зелень**

Run: `npx vitest run --root server test/vehicles.test.ts`
Expected: все тесты PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/systems/vehicles.ts server/test/vehicles.test.ts
git commit -m "feat(server): steer в схеме, наезд с уроном/отбросом, таран, разворот на границе беззоны"
```

---

### Task 6: Зомби — система, поля рантайма, скорость в tickMovement

**Files:**
- Create: `server/src/systems/zombies.ts`
- Modify: `server/src/runtime.ts`, `server/src/systems/movement.ts`
- Test: `server/test/zombies.test.ts`

**Interfaces:**
- Consumes: `handleAttack`/`AttackResult` (Task 4), `ZOMBIE_*`, `inAnyAABB` (Task 1).
- Produces: `spawnZombies(state, runtimes, map, now): void`; `tickZombies(state, runtimes, map, colliders, now): AttackResult[]`. `Runtime` += `nextWanderAt: number; wanderRotY: number`. Используется в Task 7.

- [ ] **Step 1: Падающие тесты**

Создать `server/test/zombies.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { spawnZombies, tickZombies } from '../src/systems/zombies.js';
import { tickMovement } from '../src/systems/movement.js';
import { ZOMBIE_COUNT, ZOMBIE_HP, ZOMBIE_DAMAGE, MAX_HP, pointInAABB, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const runtimes = new Map<string, Runtime>();
  spawnZombies(state, runtimes, map, 0);
  return { state, runtimes };
}

function firstZombie(state: GameState): [string, Player] {
  let found: [string, Player] | null = null;
  state.players.forEach((p, id) => { if (!found && p.role === 'zombie') found = [id, p]; });
  return found!;
}

describe('зомби', () => {
  it('спавн: ZOMBIE_COUNT зомби с ролью и HP на точках спавна', () => {
    const { state } = setup();
    let n = 0;
    state.players.forEach((p) => {
      if (p.role !== 'zombie') return;
      n++;
      expect(p.hp).toBe(ZOMBIE_HP);
      expect(p.name).toBe('Зомби');
    });
    expect(n).toBe(ZOMBIE_COUNT);
  });

  it('преследование: input направлен на ближайшего игрока, зомби движется к нему', () => {
    const { state, runtimes } = setup();
    const [zid, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const hero = new Player();
    hero.name = 'hero';
    hero.x = 10; hero.z = 0;
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    tickZombies(state, runtimes, map, [], 100);
    const inp = runtimes.get(zid)!.input;
    expect(inp.up).toBe(true);
    expect(inp.rotY).toBeCloseTo(Math.atan2(-10, 0), 5); // -PI/2
    const d0 = Math.hypot(hero.x - z.x, hero.z - z.z);
    tickMovement(state, runtimes, [], 0.05, 150);
    expect(Math.hypot(hero.x - z.x, hero.z - z.z)).toBeLessThan(d0);
  });

  it('в упоре бьёт: AttackResult с hit по ZOMBIE_DAMAGE', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const hero = new Player();
    hero.x = 1.5; hero.z = 0;
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 2000); // кулдаун кулака прошёл
    expect(hero.hp).toBe(MAX_HP - ZOMBIE_DAMAGE);
    expect(results.some(r => r.hits.length > 0)).toBe(true);
  });

  it('игрок в безопасной зоне игнорируется', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    z.x = -150; z.z = -100; // рядом с зоной больницы
    const hero = new Player();
    hero.x = map.hospitalDoor.x; hero.z = map.hospitalDoor.z; // внутри зоны
    state.players.set('h1', hero);
    runtimes.set('h1', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 100);
    expect(results).toHaveLength(0);
    expect(hero.hp).toBe(MAX_HP);
  });

  it('зомби не целится в зомби', () => {
    const { state, runtimes } = setup();
    const [zid, z] = firstZombie(state);
    z.x = 0; z.z = 0;
    const other = new Player();
    other.name = 'Зомби'; other.role = 'zombie';
    other.x = 1; other.z = 0;
    state.players.set('zOther', other);
    runtimes.set('zOther', makeRuntime(0));
    const results = tickZombies(state, runtimes, map, [], 2000); // кулдаун прошёл — но цели-зомби нет
    expect(results).toHaveLength(0);
    expect(other.hp).toBe(MAX_HP);
  });

  it('зомби выталкивается из безопасной зоны', () => {
    const { state, runtimes } = setup();
    const [, z] = firstZombie(state);
    const zone = map.safeZones[0];
    z.x = zone.x; z.z = zone.z; // в самом центре зоны
    tickZombies(state, runtimes, map, [], 100);
    expect(pointInAABB(z.x, z.z, zone)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить, увидеть падение**

Run: `npx vitest run --root server test/zombies.test.ts`
Expected: FAIL — модуль `zombies.js` не найден.

- [ ] **Step 3: runtime.ts — поля блуждания**

В `server/src/runtime.ts` в интерфейс `Runtime` добавить:

```ts
  nextWanderAt: number; // зомби: когда переслучить направление блуждания
  wanderRotY: number;
```

в `makeRuntime` добавить: `nextWanderAt: 0, wanderRotY: 0,`

- [ ] **Step 4: movement.ts — скорость зомби**

В `server/src/systems/movement.ts` строку `const res = stepFoot(p.x, p.z, rt.input, dt, colliders);` заменить на:

```ts
      const res = stepFoot(p.x, p.z, rt.input, dt, colliders, p.role === 'zombie' ? ZOMBIE_SPEED : PLAYER_SPEED);
```

Импорт дополнить: `ZOMBIE_SPEED, PLAYER_SPEED` из '@mmo/shared'.

- [ ] **Step 5: zombies.ts — реализация**

Создать `server/src/systems/zombies.ts`:

```ts
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
    state.players.forEach((p) => {
      if (p.role === 'zombie' || p.mode !== 'foot') return;
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
```

- [ ] **Step 6: Запустить, увидеть зелень**

Run: `npx vitest run --root server test/zombies.test.ts`
Expected: 6 тестов PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/systems/zombies.ts server/src/runtime.ts server/src/systems/movement.ts server/test/zombies.test.ts
git commit -m "feat(server): зомби-NPC — спавн, преследование, атака, выталкивание из беззон"
```

---

### Task 7: CityRoom — проводка систем, broadcast hit/swing, savePlayer без зомби

**Files:**
- Modify: `server/src/rooms/CityRoom.ts`
- Test: `server/test/room.integration.test.ts`

**Interfaces:**
- Consumes: всё из Tasks 3–6.
- Produces: сообщения `hit { victim, damage, x, z }` и `swing { player }` в broadcast (их ждут клиентские таски 8).

- [ ] **Step 1: Падающие интеграционные тесты**

Добавить в `server/test/room.integration.test.ts` (импорт дополнить `ZOMBIE_COUNT, PUNCH_DAMAGE`):

```ts
  it('зомби создаются в комнате и не пишутся в БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    let zombies = 0;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') zombies++; });
    expect(zombies).toBe(ZOMBIE_COUNT);
    const z0 = room.state.players.get('z0');
    z0.cash = 777;
    (room as any).savePlayer('z0');
    expect((room as any).db.load('Зомби').cash).not.toBe(777); // запись не создалась/не обновилась
  });

  it('удар кулаком: broadcast hit жертве и swing всем', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'boxer', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'target', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    p1.x = 0; p1.z = 0; p1.rotY = 0;
    p2.x = 0; p2.z = -1.5;
    let hit: any = null;
    let swing: any = null;
    c2.onMessage('hit', (m) => { hit = m; });
    c1.onMessage('swing', (m) => { swing = m; });
    c1.send('attack');
    await new Promise(r => setTimeout(r, 200));
    expect(hit?.victim).toBe(c2.sessionId);
    expect(hit?.damage).toBe(PUNCH_DAMAGE);
    expect(swing?.player).toBe(c1.sessionId);
  });

  it('пикап подбирается на сервере: игрок на точке получает оружие', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'lucky', role: 'citizen' });
    const p = room.state.players.get(client.sessionId);
    const pk = [...room.state.pickups.values()][0] as any;
    pk.kind = 'rifle';
    p.x = pk.x; p.z = pk.z;
    await new Promise(r => setTimeout(r, 200));
    expect(p.weapon).toBe('rifle');
    expect(pk.active).toBe(false);
  });
```

Внимание: комната теперь полна зомби (20 штук бродят). Старые тесты не должны сломаться: они ставят игроков в конкретные точки, а зомби агро-радиус 25 м — при совпадении координат возможны флаки. Если старый тест падает из-за зомби, в нём отогнать зомби: после `createRoom` добавить строку `room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } });`. Применить к тестам «ввод двигает игрока», «вход в машину», «выстрел через attack», «удар кулаком» и новым тестам с позициями (кроме зомби-теста).

- [ ] **Step 2: Запустить, увидеть падение**

Run: `npx vitest run --root server test/room.integration.test.ts`
Expected: FAIL — зомби не созданы, `hit`/`swing` не шлются, пикапов нет.

- [ ] **Step 3: Реализация CityRoom.ts**

Импорты дополнить:

```ts
import { handleAttack, tickRespawn, type AttackResult } from '../systems/combat.js';
import { spawnPickups, tickPickups, type PickupRuntime } from '../systems/pickups.js';
import { spawnZombies, tickZombies } from '../systems/zombies.js';
```

(строку импорта combat заменить; сейчас там `import { handleAttack, tickRespawn } from '../systems/combat.js';`)

Поле класса после `chatLog`:

```ts
  private pickupRuntime = new Map<string, PickupRuntime>();
```

В `onCreate` после цикла по квартирам добавить:

```ts
    const now0 = Date.now();
    spawnPickups(this.state, this.map, this.pickupRuntime);
    spawnZombies(this.state, this.runtimes, this.map, now0);
```

Обработчик `attack` заменить:

```ts
    this.onMessage('attack', (client) => {
      const res = handleAttack(this.state, this.runtimes, client.sessionId, Date.now(), this.colliders, this.map.safeZones);
      this.broadcastAttack(res);
    });
```

В `tick` после `tickVehicles(...)` заменить вызов и добавить системы:

```ts
    const carHits = tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots, this.map.safeZones);
    for (const h of carHits) this.broadcast('hit', h);
    const zombieAttacks = tickZombies(this.state, this.runtimes, this.map, this.colliders, now);
    for (const res of zombieAttacks) this.broadcastAttack(res);
    tickPickups(this.state, this.pickupRuntime, now);
```

Приватный метод (рядом с `handleInteract`):

```ts
  private broadcastAttack(res: AttackResult): void {
    if (res.shot) this.broadcast('shot', { ...res.shot, attacker: res.attacker }); // attacker — клиентской отдаче/вспышке
    if (res.swing) this.broadcast('swing', { player: res.attacker });
    for (const h of res.hits) this.broadcast('hit', h);
  }
```

В `savePlayer` после `if (!p || !rt) return;` добавить:

```ts
    if (p.role === 'zombie') return; // зомби не персистентны
```

- [ ] **Step 4: Прогон всех серверных тестов**

Run: `npx vitest run --root server`
Expected: все файлы PASS (включая старые интеграционные).

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/CityRoom.ts server/test/room.integration.test.ts
git commit -m "feat(server): комната — зомби и пикапы в тике, broadcast hit/swing, зомби вне БД"
```

---

### Task 8: Клиент — бой: цифры урона, HP-полоска, анимации, бита, прицел по ПКМ

**Files:**
- Modify: `client/src/avatars.ts`, `client/src/effects.ts`, `client/src/input.ts`, `client/src/ui.ts`, `client/src/main.ts`, `client/index.html`, `client/src/style.css`

**Interfaces:**
- Consumes: broadcast `hit { victim, damage, x, z }`, `swing { player }`, `shot { ..., attacker }` (Task 7).
- Produces: `Avatars.playSwing(id)`, `Avatars.playRecoil(id)`; `InputController.aiming: boolean`; `UI(room, map, avatars, input)` — новый 4-й параметр конструктора.

Клиентских автотестов нет — шаги: код → сборка → коммит.

- [ ] **Step 1: input.ts — ПКМ (aiming)**

В класс `InputController` добавить поле `aiming = false;` и в конструктор после mousemove:

```ts
    dom.addEventListener('mousedown', (e) => { if (e.button === 2) this.aiming = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.aiming = false; });
    dom.addEventListener('contextmenu', (e) => e.preventDefault()); // без меню по ПКМ
```

В обработчик `blur` добавить `this.aiming = false;` (рядом с `keys.clear()`).

- [ ] **Step 2: index.html + style.css — прицел**

В `client/index.html` внутрь `#hud` (перед `#vignette`) добавить:

```html
    <div id="crosshair" class="hidden"></div>
```

В `client/src/style.css` добавить:

```css
#crosshair {
  position: absolute; top: 50%; left: 50%; width: 6px; height: 6px;
  transform: translate(-50%, -50%); border-radius: 50%;
  background: #fff; box-shadow: 0 0 4px 1px rgba(0,0,0,.8);
}
```

- [ ] **Step 3: ui.ts — конструктор с InputController, прицел**

Импорт: `import type { InputController } from './input.js';`
Поле: `private crosshair = document.getElementById('crosshair')!;`
Конструктор: `constructor(private room: Room, private map: CityMap, private avatars: Avatars, private input: InputController) {`

В `update()` после вычисления `me` добавить:

```ts
    const dialogsClosed = this.safeDialog.classList.contains('hidden')
      && this.shopDialog.classList.contains('hidden')
      && this.chatInput.classList.contains('hidden');
    const showCross = this.input.aiming && document.pointerLockElement !== null
      && me.mode !== 'dead' && dialogsClosed;
    this.crosshair.classList.toggle('hidden', !showCross);
```

- [ ] **Step 4: main.ts — проброс input в UI**

Строку `const ui = new UI(room, map, avatars);` заменить на `const ui = new UI(room, map, avatars, input);`

- [ ] **Step 5: avatars.ts — HP-полоска, бита, вспышка, анимации, цвет зомби**

Импорт дополнить: `import { WEAPONS, MAX_HP, type WeaponKind } from '@mmo/shared';`

Интерфейс `PlayerMesh` заменить на:

```ts
interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  marker: THREE.Mesh;
  gun: THREE.Mesh;
  fistL: THREE.Mesh;
  fistR: THREE.Mesh;
  bat: THREE.Mesh;
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  flash: THREE.Sprite;
  swingAt: number;
  recoilAt: number;
}
```

В `makeNameLabel` роли: `const roleRu = role === 'cop' ? 'Полицейский' : role === 'zombie' ? 'Зомби' : 'Гражданин';` и цвет роли: `ctx.fillStyle = role === 'cop' ? '#77aaff' : role === 'zombie' ? '#77cc66' : '#bbbbbb';`

В `makePlayerMesh` перед `return` добавить:

```ts
  const bat = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
  );
  bat.position.set(0.55, 1.2, -0.2);
  bat.visible = false;
  group.add(bat);
  const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x222222 }));
  hpBg.scale.set(1.2, 0.12, 1);
  hpBg.position.y = 2.12;
  group.add(hpBg);
  const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x33cc33 }));
  hpFg.scale.set(1.2, 0.12, 1);
  hpFg.position.y = 2.13;
  group.add(hpFg);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffee88, transparent: true }));
  flash.scale.set(0.5, 0.5, 1);
  flash.position.set(0, 0, -0.45); // у дула (дочерний к gun)
  flash.visible = false;
  gun.add(flash);
```

`return` заменить на:

```ts
  return { group, body, head, marker, gun, fistL, fistR, bat, hpBg, hpFg, flash, swingAt: 0, recoilAt: 0 };
```

Публичные методы класса `Avatars` (после `meshPos`):

```ts
  playSwing(id: string): void {
    const mesh = this.players.get(id);
    if (mesh) mesh.swingAt = performance.now();
  }

  playRecoil(id: string): void {
    const mesh = this.players.get(id);
    if (mesh) mesh.recoilAt = performance.now();
  }
```

В `update()` в цикле по игрокам:

цвет тела: `p.role === 'cop' ? 0x2244ff : p.role === 'zombie' ? 0x33aa33 : 0x888888`

после строк видимости кулаков/оружия добавить:

```ts
      mesh.bat.visible = onFoot && p.weapon === 'bat';
      // HP-полоска — над чужими живыми пешеходами (у себя HP в HUD)
      const showHp = id !== this.room.sessionId && p.mode === 'foot';
      mesh.hpBg.visible = showHp;
      mesh.hpFg.visible = showHp;
      if (showHp) {
        const k = Math.max(0, Math.min(1, p.hp / MAX_HP));
        mesh.hpFg.scale.x = 1.2 * k;
        mesh.hpFg.position.x = -1.2 * (1 - k) / 2; // левый край зафиксирован
        (mesh.hpFg.material as THREE.SpriteMaterial).color.set(k > 0.5 ? 0x33cc33 : k > 0.25 ? 0xddaa22 : 0xcc2222);
      }
      // замах (150 мс): правая рука/бита вперёд-назад
      const st = (performance.now() - mesh.swingAt) / 150;
      const swingZ = st < 1 ? Math.sin(st * Math.PI) * 0.6 : 0;
      mesh.fistR.position.z = -0.15 - swingZ;
      mesh.bat.position.z = -0.2 - swingZ;
      // отдача (80 мс): ствол назад + вспышка у дула
      const rc = (performance.now() - mesh.recoilAt) / 80;
      mesh.gun.position.z = -0.35 + (rc < 1 ? Math.sin(rc * Math.PI) * 0.15 : 0);
      mesh.flash.visible = rc < 0.75;
```

- [ ] **Step 6: effects.ts — цифры урона, swing/recoil из событий**

После интерфейса `Tracer` добавить:

```ts
interface DamageNumber { sprite: THREE.Sprite; bornAt: number }
const DAMAGE_MS = 700;
```

Поля класса: `private damageNumbers: DamageNumber[] = [];`

В конструкторе подписки дополнить:

```ts
    room.onMessage('hit', (msg: any) => this.onHit(msg));
    room.onMessage('swing', (msg: any) => this.avatars.playSwing(msg.player));
```

В `onShot` (тип msg дополнить `attacker?: string`) первой строкой тела:

```ts
    if (msg.attacker) this.avatars.playRecoil(msg.attacker);
```

Метод цифр урона:

```ts
  private onHit(msg: { victim: string; damage: number; x: number; z: number }): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(`-${msg.damage}`, 64, 32);
    ctx.fillStyle = '#ff5544';
    ctx.fillText(`-${msg.damage}`, 64, 32);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.scale.set(1.4, 0.7, 1);
    sprite.position.set(msg.x + (Math.random() - 0.5) * 0.6, 2.3, msg.z);
    this.scene.add(sprite);
    this.damageNumbers.push({ sprite, bornAt: performance.now() });
  }
```

В `update()` после цикла tracer'ов добавить:

```ts
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      const t = (now - d.bornAt) / DAMAGE_MS;
      if (t >= 1) {
        this.scene.remove(d.sprite);
        const m = d.sprite.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.dispose();
        this.damageNumbers.splice(i, 1);
      } else {
        d.sprite.position.y = 2.3 + t * 0.7;
        (d.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
      }
    }
```

- [ ] **Step 7: Сборка**

Run: `npm run build -w client`
Expected: `✓ built` без ошибок tsc.

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "feat(client): цифры урона, HP-полоски, замах/отдача/вспышка, меш биты, прицел по ПКМ"
```

---

### Task 9: Клиент — мир: колёса, пикапы, GTA-круги, забор, кладбище

**Files:**
- Modify: `client/src/avatars.ts` (колёса), `client/src/world.ts` (круги/забор/кладбище), `client/src/main.ts`
- Create: `client/src/pickups.ts`

**Interfaces:**
- Consumes: `car.steer`, `state.pickups` (Task 2/7), `map.safeZones/zombieSpawns`, `TARGET_LABELS` из shared (Task 1).

- [ ] **Step 1: avatars.ts — колёса со steer и вращением**

Заменить `makeCarMesh` и работу с машинами:

```ts
interface CarMesh { group: THREE.Group; wheelFL: THREE.Group; wheelFR: THREE.Group; wheels: THREE.Mesh[] }

const WHEEL_AXIS_Y = new THREE.Vector3(0, 1, 0);

function makeCarMesh(): CarMesh {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0xcc3333 }),
  );
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x333344 }),
  );
  cabin.position.set(0, 1.15, -0.2);
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const spokeMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const wheels: THREE.Mesh[] = [];
  let wheelFL = new THREE.Group();
  let wheelFR = new THREE.Group();
  for (const [wx, wz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]] as const) {
    const mount = new THREE.Group();
    mount.position.set(wx, 0.35, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.1), spokeMat); // чтобы вращение читалось
    wheel.add(spoke);
    mount.add(wheel);
    group.add(mount);
    wheels.push(wheel);
    if (wz < 0 && wx < 0) wheelFL = mount; // перед — отрицательный z (нос машины)
    if (wz < 0 && wx > 0) wheelFR = mount;
  }
  return { group, wheelFL, wheelFR, wheels };
}
```

`private cars = new Map<string, CarMesh>();`

`cars.onAdd`/`onRemove` и цикл `update()` по машинам привести к виду:

```ts
    $(room.state).cars.onAdd((c: any, id: string) => {
      const mesh = makeCarMesh();
      mesh.group.position.set(c.x, 0, c.z);
      mesh.group.rotation.y = c.rotY;
      this.cars.set(id, mesh);
      this.carSnaps.set(id, []);
      scene.add(mesh.group);
    });
    $(room.state).cars.onRemove((_c: any, id: string) => {
      const mesh = this.cars.get(id);
      if (mesh) {
        scene.remove(mesh.group);
        this.cars.delete(id);
        this.carSnaps.delete(id);
      }
    });
```

```ts
    this.cars.forEach((mesh, id) => {
      const c = (this.room.state.cars as any).get(id);
      if (!c) return;
      mesh.wheelFL.rotation.y = c.steer * 0.5;
      mesh.wheelFR.rotation.y = c.steer * 0.5;
      const angle = (c.speed * dt) / 0.35; // r колеса 0.35
      for (const w of mesh.wheels) w.rotateOnAxis(WHEEL_AXIS_Y, angle);
      if (c.driverId === this.room.sessionId) {
        mesh.group.position.set(c.x, 0, c.z);
        mesh.group.rotation.y = c.rotY;
      } else {
        const buf = this.carSnaps.get(id)!;
        pushSnap(buf, nowServer, c.x, c.z, c.rotY);
        const s = sampleSnap(buf, rt);
        if (s) {
          mesh.group.position.set(s.x, 0, s.z);
          mesh.group.rotation.y = s.rotY;
        }
      }
    });
```

(сигнатуру `update(_dt: number)` сменить на `update(dt: number)`.)

- [ ] **Step 2: pickups.ts — меши и надписи пикапов**

Создать `client/src/pickups.ts`:

```ts
import * as THREE from 'three';
import { getStateCallbacks, type Room } from 'colyseus.js';

const KIND_LABELS: Record<string, string> = {
  bat: 'Бита', pistol: 'Пистолет', rifle: 'Винтовка', ammo: 'Патроны',
};

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 4, 256, 56);
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 32, 240);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.y = 1.6;
  return sprite;
}

function makeBody(kind: string): THREE.Mesh {
  let geo: THREE.BoxGeometry;
  let mat: THREE.Material;
  if (kind === 'bat') {
    geo = new THREE.BoxGeometry(0.15, 0.15, 0.9);
    mat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  } else if (kind === 'pistol') {
    geo = new THREE.BoxGeometry(0.15, 0.2, 0.4);
    mat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  } else if (kind === 'rifle') {
    geo = new THREE.BoxGeometry(0.15, 0.2, 1.1);
    mat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  } else if (kind === 'cash') {
    geo = new THREE.BoxGeometry(0.4, 0.12, 0.25);
    mat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
  } else { // ammo
    geo = new THREE.BoxGeometry(0.35, 0.25, 0.35);
    mat = new THREE.MeshLambertMaterial({ color: 0x33aa33 });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.6;
  return mesh;
}

interface PickupEntry { group: THREE.Group; kind: string; phase: number }

export class Pickups {
  private items = new Map<string, PickupEntry>();

  constructor(private scene: THREE.Scene, private room: Room) {
    const $ = getStateCallbacks(room);
    $(room.state).pickups.onAdd((pk: any, id: string) => {
      const group = new THREE.Group();
      group.position.set(pk.x, 0, pk.z);
      this.scene.add(group);
      const entry: PickupEntry = { group, kind: '', phase: Math.random() * Math.PI * 2 };
      this.rebuild(entry, pk);
      this.items.set(id, entry);
    });
    $(room.state).pickups.onRemove((_pk: any, id: string) => {
      const entry = this.items.get(id);
      if (entry) {
        this.dispose(entry);
        this.scene.remove(entry.group);
        this.items.delete(id);
      }
    });
  }

  private dispose(entry: PickupEntry): void {
    entry.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m) {
        (m as unknown as THREE.SpriteMaterial).map?.dispose();
        m.dispose();
      }
    });
  }

  private rebuild(entry: PickupEntry, pk: any): void {
    this.dispose(entry);
    entry.group.clear();
    entry.group.add(makeBody(pk.kind));
    entry.group.add(makeLabel(pk.kind === 'cash' ? `${pk.amount}$` : KIND_LABELS[pk.kind] ?? pk.kind));
    entry.kind = pk.kind;
  }

  update(): void {
    const now = performance.now();
    this.items.forEach((entry, id) => {
      const pk = (this.room.state.pickups as any).get(id);
      if (!pk) return;
      if (pk.kind !== entry.kind) this.rebuild(entry, pk); // вид сменился при респауне
      entry.group.visible = pk.active;
      entry.group.rotation.y = now / 1000 + entry.phase;
      entry.group.position.y = 0.1 + Math.sin(now / 400 + entry.phase) * 0.1;
    });
  }
}
```

- [ ] **Step 3: main.ts — подключить Pickups**

Импорт `import { Pickups } from './pickups.js';`, после `const effects = ...`:

```ts
  const pickups = new Pickups(scene, room);
```

в цикле после `effects.update();` добавить `pickups.update();`

- [ ] **Step 4: world.ts — GTA-круги, забор, кладбище, TARGET_LABELS из shared**

Импорт дополнить `TARGET_LABELS` в строку из '@mmo/shared'; локальную константу `TARGET_LABELS` внизу файла УДАЛИТЬ.

Блок `mark` заменить на светящиеся цилиндры (стиль GTA SA), маркеры — на всех точках взаимодействия:

```ts
  const mark = (p: Point, color: number) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 1.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.position.set(p.x, 0.8, p.z);
    scene.add(m);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.05, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    ring.position.set(p.x, 0.03, p.z);
    scene.add(ring);
  };
  mark(map.warehouse, 0xff8800);
  mark(map.gunShop, 0xcc44ff);
  for (const t of map.deliveryTargets) mark(t, 0x00cccc);
  mark(map.hospitalDoor, 0xffffff);
  mark(map.policeDoor, 0x2244ff);
  for (const a of map.apartments) mark(a, 0xffcc00);
```

(старые вызовы `mark(..., size)` и плоские диски удалить; двери квартир-боксы остаются.)

Перед `return map;` добавить забор, подписи зон и кладбище:

```ts
  // забор вокруг безопасных зон, ворота — южная грань (к дороге)
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  for (const z of map.safeZones) {
    const minX = z.x - z.w / 2;
    const maxX = z.x + z.w / 2;
    const minZ = z.z - z.d / 2;
    const maxZ = z.z + z.d / 2;
    const seg = (x: number, zz: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), fenceMat);
      m.position.set(x, 0.6, zz);
      scene.add(m);
    };
    for (let x = minX + 1; x <= maxX - 1; x += 2) {
      seg(x, minZ, 2, 0.15);
      if (Math.abs(x - z.x) > 3) seg(x, maxZ, 2, 0.15); // ворота
    }
    for (let zz = minZ + 1; zz <= maxZ - 1; zz += 2) {
      seg(minX, zz, 0.15, 2);
      seg(maxX, zz, 0.15, 2);
    }
    const zoneLabel = makeTextSprite('Безопасная зона');
    zoneLabel.position.set(z.x, 4, z.z);
    scene.add(zoneLabel);
  }

  // кладбище у первой точки спавна зомби
  const grave = map.zombieSpawns[0];
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshLambertMaterial({ color: 0x2f2f26 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(grave.x, 0.04, grave.z);
  scene.add(yard);
  const graveLabel = makeTextSprite('Кладбище');
  graveLabel.position.set(grave.x, 5, grave.z);
  scene.add(graveLabel);
```

- [ ] **Step 5: Сборка**

Run: `npm run build -w client`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "feat(client): колёса со steer/вращением, пикапы с надписями, GTA-круги, забор, кладбище"
```

---

### Task 10: Клиент — баг-фиксы: pointer lock в диалогах, многострочные баннеры

**Files:**
- Modify: `client/src/ui.ts`, `client/src/style.css`

**Interfaces:**
- Consumes: `TARGET_LABELS` из shared (Task 1).

- [ ] **Step 1: ui.ts — pointer lock и баннеры**

Обработчики открытия диалогов:

```ts
    room.onMessage('openSafe', () => {
      document.exitPointerLock(); // иначе клики не доходят до кнопок под захватом мыши
      this.safeDialog.classList.remove('hidden');
    });
```

```ts
    room.onMessage('openShop', () => {
      document.exitPointerLock();
      this.shopDialog.classList.remove('hidden');
    });
```

Импорт дополнить `TARGET_LABELS` в строку из '@mmo/shared'.

Блок баннеров в `update()` заменить на многострочный (все активные строки сразу):

```ts
    const lines: string[] = [];
    if (me.mode === 'jail') {
      lines.push(`ТЮРЬМА: ${Math.max(0, Math.ceil((me.jailUntil - nowServer) / 1000))} сек`);
    }
    if (me.wantedUntil > nowServer) {
      lines.push(`В РОЗЫСКЕ: ${Math.ceil((me.wantedUntil - nowServer) / 1000)} сек`);
    }
    if (me.cargo) {
      const target = TARGET_LABELS[me.deliveryTarget] ?? me.deliveryTarget;
      lines.push(`Груз → ${target}: ${Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000))} сек`);
    }
    if (me.mode === 'dead') lines.push('Вы погибли. Респаун...');
    this.banner.textContent = lines.join('\n');
    this.banner.classList.toggle('hidden', lines.length === 0);
```

(старый `bannerText`/if-else-if блок удалить.)

- [ ] **Step 2: style.css — переносы в баннере**

В правило `#banner` добавить `white-space: pre; text-align: center;`

- [ ] **Step 3: Сборка**

Run: `npm run build -w client`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add client/src/ui.ts client/src/style.css
git commit -m "fix(client): pointer lock при диалогах, многострочные баннеры, русские цели доставки"
```

---

### Task 11: README, полный прогон, финал

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README — чек-лист и ограничения**

В «Ручной чек-лист» пункт 8 заменить на: «Убить игрока — он респавнится у больницы (в безопасной зоне), деньги из сейфа не потерял, часть наличных выпала пикапом на месте смерти — любой может подобрать».

Добавить пункты:

```markdown
11. Ударить игрока — видны «−20» над жертвой и анимация замаха; у второго игрока над головой полоска HP; зажать ПКМ — прицел по центру.
12. Купить биту — в руке коричневый брусок; выстрел из пистолета — tracer, вспышка у дула, отдача.
13. Езда на машине: передние колёса поворачивают при A/D, все крутятся; наезд на игрока — урон и отброс (+ «−N»), на малой скорости — только толчок; таран — машины разъезжаются.
14. Въезд в огороженную зону больницы/полиции на машине — разворачивает обратно; внутри зоны удары и выстрелы не наносят урона (обе стороны).
15. По карте крутятся пикапы с надписями (Бита/Пистолет/Винтовка/Патроны) — подбор касанием, через ~30 сек респаун.
16. Зомби (зелёные, табличка «Зомби») гоняются и бьют; убитый воскресает на кладбище; розыска за зомби нет; в безопасную зону не заходят.
17. Открыть магазин/сейф — клики по кнопкам работают сразу (без alt-tab); диалог сам закрывается при отходе.
18. Устроить розыск при активном грузе — баннеры «В РОЗЫСКЕ» и «Груз → Порт» видны одновременно (две строки).
```

В «Известные ограничения MVP» удалить устаревшие строки: «Нет клиентского предсказания движения…» (сделано в c37e9d6), «Машины и игроки не сталкиваются между собой» (сделано в этом этапе), «Серверное время … через offset при подключении…» (сделано EMA-рекалибровкой). Добавить: «Зомби не обходят здания (скользят вдоль стен); патфайндинга нет».

В разделе «Команды» строку про тесты заменить на актуальные числа из вывода `npm test` (посчитать по итогам прогона: shared + server).

- [ ] **Step 2: Полный прогон**

Run: `npm test` из корня — все тесты PASS.
Run: `npm run build -w client` — `✓ built`.
Run: `npx tsc --noEmit -p server/tsconfig.json && npx tsc --noEmit -p shared/tsconfig.json` — exit 0.

- [ ] **Step 3: Ручная проверка с пользователем**

Dev-сервер (tsx watch) подхватит серверные правки сам; Vite — клиентские. Фоновые боты после перезапуска сервера отвалятся — при желании перезапустить задачу `bash-*` с ботами. Пройти с пользователем новые пункты чек-листа (11–18) и ключевые старые.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): чек-лист этапа «бой, машины и зомби», актуализация ограничений"
```

---

## Самопроверка плана (выполнена автором)

- Покрытие спеки: §сервер (события/наезд/таran/steer/пикапы/зомби/дроп/респаун/разворот) → Tasks 3–7; §клиент (бой/мир/баги) → Tasks 8–10; §тестирование → шаги тестов + Task 11. Изменение схемы и совместный деплой — Task 2 + Global Constraints.
- `handleAttack` меняет контракт (`Shot|null` → `AttackResult`) — единственные вызовы: CityRoom (Task 7), zombies (Task 6), combat-тесты (Task 4 Step 2). Других вызовов в кодовой базе нет (проверено чтением).
- `tickVehicles` обратно-совместим (дефолтные параметры), `stepFoot` обратно-совместим (дефолт скорости).
- Типы согласованы: `AttackResult.attacker` используется в Task 7 (`swing`, spread в `shot`) и Task 8 (`playRecoil`/`playSwing`); `Pickup.amount` — Tasks 2/3/4/9; `Hit` — Tasks 4/5/7/8.
