# MMO Real Life MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Браузерная 3D MMO на 100 игроков: маленький город, аренда квартир, кулачный бой, машины с аркадной физикой, игроки-полицейские.

**Architecture:** Монорепо (npm workspaces): `shared` (конфиг, карта, физика), `server` (Colyseus, авторитетный, тик 20 Гц, SQLite), `client` (Three.js + Vite). Клиенты шлют ввод, сервер симулирует и рассылает состояние; клиент интерполирует.

**Tech Stack:** Node.js 24, TypeScript, Colyseus, Three.js, better-sqlite3, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-07-17-mmo-real-life-mvp-design.md`

## Global Constraints

- Node.js >= 22 (в окружении v24.15.0), npm workspaces.
- Весь код на TypeScript, ESM (`"type": "module"` во всех пакетах).
- Один мир = одна комната `city`, максимум 100 игроков (`MAX_PLAYERS`).
- Тик сервера 20 Гц; клиент шлёт ввод каждые 50 мс.
- Никаких внешних 3D-ассетов — всё из примитивов Three.js.
- Коммиты на русском не обязательны; сообщения в стиле conventional commits (`feat:`, `fix:`, `test:`, `chore:`).
- Каждая задача завершается коммитом.
- Тесты: Vitest, запуск `npm test` из корня (прогоняет shared и server).

---

### Task 1: Скелет монорепо + shared-конфиг

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/config.ts`
- Create: `shared/src/index.ts`

**Interfaces:**
- Produces: пакет `@mmo/shared` со всеми игровыми константами из `config.ts`. Все остальные задачи импортируют константы отсюда.

- [ ] **Step 1: Создать корневые файлы**

`package.json`:

```json
{
  "name": "mmo2game",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm run test -w shared && npm run test -w server",
    "build": "npm run build -w client"
  },
  "devDependencies": {
    "concurrently": "^9.0.0",
    "typescript": "^5.6.0"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
game.db*
*.log
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

`shared/package.json`:

```json
{
  "name": "@mmo/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

`shared/tsconfig.json`:

```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

- [ ] **Step 2: Написать `shared/src/config.ts`**

```ts
// Игровые константы. Единый источник правды для сервера и клиента.
export const TICK_RATE = 20;
export const MAP_HALF = 200; // мир 400x400, координаты от -200 до 200

export const PLAYER_RADIUS = 0.5;
export const PLAYER_SPEED = 5;
export const PLAYER_SPRINT = 8;

export const CAR_RADIUS = 1.5;
export const CAR_MAX_SPEED = 20;
export const CAR_ACCEL = 12;
export const CAR_BRAKE = 25;
export const CAR_DRAG = 6;
export const CAR_TURN_RATE = 1.8;
export const CAR_ENTER_DIST = 3;
export const CAR_PARK_RETURN_MS = 5 * 60_000;

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
```

`shared/src/index.ts`:

```ts
export * from './config.js';
export * from './map.js';
export * from './physics.js';
```

(Файлы `map.ts` и `physics.ts` появятся в задачах 2 и 3 — до их создания оставить в `index.ts` только `export * from './config.js';` и дописывать строки по мере появления модулей.)

- [ ] **Step 3: Установить зависимости**

Run: `npm install`
Expected: завершение без ошибок, появился `node_modules/` в корне.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: скелет монорепо и shared-конфиг"
```

---

### Task 2: Карта города (`shared/src/map.ts`)

**Files:**
- Create: `shared/src/map.ts`
- Test: `shared/test/map.test.ts`
- Modify: `shared/src/index.ts` (добавить `export * from './map.js';`)

**Interfaces:**
- Consumes: `MAP_HALF` из `./config.js`.
- Produces: `ROADS`, `ROAD_WIDTH`, типы `BuildingDef`, `Point`, `DoorPoint`, `ParkingSpot`, `DeliveryTarget`, `CityMap`, функцию `createCityMap(): CityMap`. Координаты используются сервером (коллизии, спавны) и клиентом (рендер).

Раскладка: блоки 4x4, центры блоков в `-150 + i*100` (i,j от 0 до 3), здание 36x36 в центре блока. Спецздания: hospital блок (0,0), police (3,0), warehouse (0,3). Дороги по линиям -100, 0, 100 (ширина 20) в обоих направлениях.

- [ ] **Step 1: Написать failing-тест `shared/test/map.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createCityMap, MAP_HALF, CAR_RADIUS } from '../src/index.js';
import { collidesCircleAABB } from '../src/physics.js';

describe('createCityMap', () => {
  const map = createCityMap();

  it('все здания внутри границ мира', () => {
    for (const b of map.buildings) {
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(MAP_HALF);
      expect(Math.abs(b.z) + b.d / 2).toBeLessThanOrEqual(MAP_HALF);
    }
  });

  it('ровно 10 квартир, двери не пересекаются со зданиями', () => {
    expect(map.apartments).toHaveLength(10);
    for (const door of map.apartments) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(door.x, door.z, 1, b)).toBe(false);
      }
    }
  });

  it('15 парковочных мест не пересекаются со зданиями', () => {
    expect(map.parkingSpots).toHaveLength(15);
    for (const s of map.parkingSpots) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(s.x, s.z, CAR_RADIUS, b)).toBe(false);
      }
    }
  });

  it('точки доставки и ключевые места не внутри зданий', () => {
    const pts = [...map.deliveryTargets, map.hospitalDoor, map.policeDoor, map.jailCell, map.warehouse];
    for (const p of pts) {
      for (const b of map.buildings) {
        expect(collidesCircleAABB(p.x, p.z, 1, b)).toBe(false);
      }
    }
  });

  it('есть все три точки доставки: shop, gas, port', () => {
    const ids = map.deliveryTargets.map(t => t.id).sort();
    expect(ids).toEqual(['gas', 'port', 'shop']);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w shared`
Expected: FAIL (`collidesCircleAABB` не импортируется / модуля нет).

- [ ] **Step 3: Написать `shared/src/map.ts`**

```ts
import { MAP_HALF } from './config.js';

export const ROADS = [-100, 0, 100];
export const ROAD_WIDTH = 20;

export interface BuildingDef {
  x: number; z: number; w: number; d: number; h: number;
  color: number;
  kind: 'house' | 'hospital' | 'police' | 'warehouse';
}
export interface Point { x: number; z: number; }
export interface DoorPoint extends Point { id: string; }
export interface ParkingSpot extends Point { id: string; }
export interface DeliveryTarget extends Point { id: string; }

export interface CityMap {
  buildings: BuildingDef[];
  apartments: DoorPoint[];
  parkingSpots: ParkingSpot[];
  deliveryTargets: DeliveryTarget[];
  hospitalDoor: Point;
  policeDoor: Point;
  jailCell: Point;
  warehouse: Point;
}

export function createCityMap(): CityMap {
  const buildings: BuildingDef[] = [];
  const special: Record<string, BuildingDef['kind']> = {
    '0,0': 'hospital',
    '3,0': 'police',
    '0,3': 'warehouse',
  };
  const specialConf = {
    hospital: { w: 40, d: 30, h: 12, color: 0xffffff },
    police: { w: 40, d: 30, h: 10, color: 0x2244aa },
    warehouse: { w: 40, d: 40, h: 8, color: 0x8b5a2b },
  } as const;
  const palette = [0x8d99ae, 0x6d6875, 0xb5838d, 0x7f8c8d, 0x95a472];

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = -150 + i * 100;
      const cz = -150 + j * 100;
      const kind = special[`${i},${j}`];
      if (kind) {
        buildings.push({ x: cx, z: cz, kind, ...specialConf[kind] });
      } else {
        const n = i * 4 + j;
        buildings.push({
          x: cx, z: cz, w: 36, d: 36,
          h: 10 + ((n * 7) % 20),
          color: palette[n % palette.length],
          kind: 'house',
        });
      }
    }
  }

  const houses = buildings.filter(b => b.kind === 'house');
  const apartments: DoorPoint[] = houses
    .slice(0, 10)
    .map((b, k) => ({ id: `apt${k}`, x: b.x, z: b.z + b.d / 2 + 1 }));

  const parkingSpots: ParkingSpot[] = Array.from({ length: 15 }, (_, k) => ({
    id: `car${k}`,
    x: -175 + k * 25,
    z: -12,
  }));

  void MAP_HALF; // границы проверяются тестами через MAP_HALF из config

  return {
    buildings,
    apartments,
    parkingSpots,
    deliveryTargets: [
      { id: 'shop', x: 50, z: 100 },
      { id: 'gas', x: -100, z: -50 },
      { id: 'port', x: 100, z: -150 },
    ],
    hospitalDoor: { x: -150, z: -133 },
    policeDoor: { x: 150, z: -133 },
    jailCell: { x: 150, z: -172 },
    warehouse: { x: -150, z: 127 },
  };
}
```

Дописать в `shared/src/index.ts`: `export * from './map.js';` (строку для `physics.js` добавить в задаче 3).

ВНИМАНИЕ: тест из Step 1 импортирует `collidesCircleAABB` из `../src/physics.js` — файл появится в задаче 3. Чтобы тест задачи 2 мог упасть/пройти независимо, в задаче 2 создать временный `shared/src/physics.ts` со следующим содержимым (задача 3 дополнит его):

```ts
export interface AABB { x: number; z: number; w: number; d: number; }

export function collidesCircleAABB(x: number, z: number, r: number, b: AABB): boolean {
  const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
  const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npm run test -w shared`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): карта города"
```

---

### Task 3: Общая физика (`shared/src/physics.ts`)

**Files:**
- Modify: `shared/src/physics.ts` (дополнить файл из задачи 2)
- Modify: `shared/src/index.ts` (добавить `export * from './physics.js';`)
- Test: `shared/test/physics.test.ts`

**Interfaces:**
- Consumes: `MAP_HALF` из `./config.js`.
- Produces: `AABB`, `collidesCircleAABB(x,z,r,b)`, `moveCircle(x,z,dx,dz,r,boxes)`, `clamp(v,min,max)`, `dist2(ax,az,bx,bz)`. Сервер использует `moveCircle` для персонажей и `collidesCircleAABB` для машин.

- [ ] **Step 1: Написать failing-тест `shared/test/physics.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { collidesCircleAABB, moveCircle, clamp, dist2 } from '../src/physics.js';

const wall = { x: 10, z: 0, w: 2, d: 10 }; // стена x: 9..11, z: -5..5

describe('collidesCircleAABB', () => {
  it('обнаруживает пересечение', () => {
    expect(collidesCircleAABB(8.8, 0, 0.5, wall)).toBe(true);
  });
  it('не пересекается на расстоянии', () => {
    expect(collidesCircleAABB(8.0, 0, 0.5, wall)).toBe(false);
  });
});

describe('moveCircle', () => {
  it('двигает свободно без препятствий', () => {
    const r = moveCircle(0, 0, 1, 0, 0.5, []);
    expect(r).toEqual({ x: 1, z: 0 });
  });
  it('блокирует ось, упирающуюся в стену', () => {
    const r = moveCircle(8, 0, 1.5, 0, 0.5, [wall]);
    expect(r.x).toBe(8);
  });
  it('позволяет скольжение вдоль стены', () => {
    const r = moveCircle(8, 0, 1.5, 3, 0.5, [wall]);
    expect(r.x).toBe(8);
    expect(r.z).toBe(3);
  });
});

describe('clamp / dist2', () => {
  it('clamp ограничивает значение', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
  it('dist2 считает квадрат расстояния', () => {
    expect(dist2(0, 0, 3, 4)).toBe(25);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w shared`
Expected: FAIL (`moveCircle`, `clamp`, `dist2` не существуют).

- [ ] **Step 3: Дополнить `shared/src/physics.ts`**

Полное итоговое содержимое файла:

```ts
export interface AABB { x: number; z: number; w: number; d: number; }

export function collidesCircleAABB(x: number, z: number, r: number, b: AABB): boolean {
  const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
  const cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

export function collidesAny(x: number, z: number, r: number, boxes: AABB[]): boolean {
  return boxes.some(b => collidesCircleAABB(x, z, r, b));
}

export function moveCircle(
  x: number, z: number, dx: number, dz: number, r: number, boxes: AABB[],
): { x: number; z: number } {
  let nx = x + dx;
  if (collidesAny(nx, z, r, boxes)) nx = x;
  let nz = z + dz;
  if (collidesAny(nx, nz, r, boxes)) nz = z;
  return { x: nx, z: nz };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
```

Дописать в `shared/src/index.ts`: `export * from './physics.js';`

- [ ] **Step 4: Запустить тесты — все должны пройти**

Run: `npm run test -w shared`
Expected: PASS (map + physics).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): физика — AABB-коллизии, moveCircle"
```

---

### Task 4: Сервер — пакет и схемы состояния

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/src/schema/GameState.ts`

**Interfaces:**
- Consumes: `@mmo/shared`.
- Produces: классы схем `Player`, `Car`, `Apartment`, `GameState` (из `@colyseus/schema`). Поля `Player`: `name, role, x, y, z, rotY, hp, mode, carId, apt, wantedUntil, jailUntil, cash, safe, cargo, deliveryTarget, deliveryDeadline`. `mode`: `'foot' | 'car' | 'jail' | 'dead'`. `role`: `'citizen' | 'cop'`.

- [ ] **Step 1: Создать файлы пакета**

`server/package.json`:

```json
{
  "name": "@mmo/server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "loadtest": "tsx loadtest/bots.ts"
  },
  "dependencies": {
    "@colyseus/schema": "^3.0.0",
    "@mmo/shared": "*",
    "better-sqlite3": "^12.0.0",
    "colyseus": "^0.16.0",
    "express": "^4.19.0"
  },
  "devDependencies": {
    "@colyseus/testing": "^0.16.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "colyseus.js": "^0.16.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "experimentalDecorators": true,
    "useDefineForClassFields": false
  },
  "include": ["src", "test", "loadtest"]
}
```

(Декораторы и `useDefineForClassFields: false` обязательны для `@colyseus/schema`.)

`server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
```

- [ ] **Step 2: Написать `server/src/schema/GameState.ts`**

```ts
import { Schema, MapSchema, type } from '@colyseus/schema';
import { MAX_HP } from '@mmo/shared';

export class Player extends Schema {
  @type('string') name = '';
  @type('string') role: 'citizen' | 'cop' = 'citizen';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') rotY = 0;
  @type('number') hp = MAX_HP;
  @type('string') mode: 'foot' | 'car' | 'jail' | 'dead' = 'foot';
  @type('string') carId = '';
  @type('string') apt = '';
  @type('number') wantedUntil = 0;
  @type('number') jailUntil = 0;
  @type('number') cash = 0;
  @type('number') safe = 0;
  @type('boolean') cargo = false;
  @type('string') deliveryTarget = '';
  @type('number') deliveryDeadline = 0;
}

export class Car extends Schema {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') rotY = 0;
  @type('number') speed = 0;
  @type('string') driverId = '';
}

export class Apartment extends Schema {
  @type('string') id = '';
  @type('number') doorX = 0;
  @type('number') doorZ = 0;
  @type('string') rentedBy = '';
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Car }) cars = new MapSchema<Car>();
  @type({ map: Apartment }) apartments = new MapSchema<Apartment>();
  @type('number') serverTime = 0;
}
```

- [ ] **Step 3: Установить зависимости и проверить компиляцию**

Run: `npm install && npx tsc -p server/tsconfig.json`
Expected: install без ошибок; tsc завершается с кодом 0 (декораторы компилируются).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): пакет сервера и схемы состояния"
```

---

### Task 5: Персистентность (SQLite)

**Files:**
- Create: `server/src/db.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces: `interface PlayerRecord { name: string; cash: number; safe: number; apt: string; kills: number; deaths: number }` и класс `GameDB` с методами `load(name: string): PlayerRecord`, `save(rec: PlayerRecord): void`, `close(): void`. Используется комнатой (Task 11).

- [ ] **Step 1: Написать failing-тест `server/test/db.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { GameDB } from '../src/db.js';
import { START_CASH } from '@mmo/shared';

describe('GameDB', () => {
  let db: GameDB;
  afterEach(() => db?.close());

  it('новый игрок получает стартовые значения', () => {
    db = new GameDB(':memory:');
    const rec = db.load('alice');
    expect(rec).toEqual({ name: 'alice', cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0 });
  });

  it('save/load сохраняет прогресс', () => {
    db = new GameDB(':memory:');
    db.load('bob');
    db.save({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1 });
    expect(db.load('bob')).toEqual({ name: 'bob', cash: 777, safe: 200, apt: 'apt3', kills: 2, deaths: 1 });
  });

  it('данные переживают переоткрытие файла', () => {
    const path = `test-${Date.now()}.db`;
    const db1 = new GameDB(path);
    db1.save({ name: 'c', cash: 1, safe: 2, apt: '', kills: 0, deaths: 0 });
    db1.close();
    const db2 = new GameDB(path);
    expect(db2.load('c').safe).toBe(2);
    db2.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
    db = new GameDB(':memory:'); // заглушка для afterEach
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`../src/db.js` не существует).

- [ ] **Step 3: Написать `server/src/db.ts`**

```ts
import Database from 'better-sqlite3';
import { START_CASH } from '@mmo/shared';

export interface PlayerRecord {
  name: string;
  cash: number;
  safe: number;
  apt: string;
  kills: number;
  deaths: number;
}

export class GameDB {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        cash INTEGER NOT NULL,
        safe INTEGER NOT NULL,
        apt TEXT NOT NULL DEFAULT '',
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  load(name: string): PlayerRecord {
    const row = this.db.prepare('SELECT * FROM players WHERE name = ?').get(name) as PlayerRecord | undefined;
    if (row) return row;
    const rec: PlayerRecord = { name, cash: START_CASH, safe: 0, apt: '', kills: 0, deaths: 0 };
    this.save(rec);
    return rec;
  }

  save(rec: PlayerRecord): void {
    this.db.prepare(`
      INSERT INTO players (name, cash, safe, apt, kills, deaths)
      VALUES (@name, @cash, @safe, @apt, @kills, @deaths)
      ON CONFLICT(name) DO UPDATE SET
        cash = @cash, safe = @safe, apt = @apt, kills = @kills, deaths = @deaths
    `).run(rec);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npm run test -w server`
Expected: PASS, 3 теста.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): SQLite-персистентность игроков"
```

---

### Task 6: Runtime-данные и система движения

**Files:**
- Create: `server/src/runtime.ts`
- Create: `server/src/systems/movement.ts`
- Test: `server/test/movement.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Player` (Task 4); `moveCircle`, `clamp`, константы (`@mmo/shared`).
- Produces:
  - `interface InputState { up: boolean; down: boolean; left: boolean; right: boolean; sprint: boolean; rotY: number }`
  - `interface Runtime { input: InputState; lastAttackAt: number; lastDamageAt: number; arrestProgress: number; respawnAt: number; nextSalaryAt: number; nextRentAt: number; kills: number; deaths: number }`
  - `makeRuntime(now: number): Runtime`
  - `tickMovement(state: GameState, runtimes: Map<string, Runtime>, colliders: AABB[], dt: number, now: number): void` — двигает игроков в режиме `'foot'`, регенерирует HP.
- Базис направления: forward = `(-sin(rotY), -cos(rotY))`, right = `(cos(rotY), -sin(rotY))`. Все задачи и клиент используют этот базис.

- [ ] **Step 1: Написать failing-тест `server/test/movement.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickMovement } from '../src/systems/movement.js';
import { PLAYER_SPEED, MAX_HP } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'a';
  state.players.set('s1', p);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(1000)]]);
  return { state, p, runtimes };
}

describe('tickMovement', () => {
  it('двигает вперёд при rotY=0 (в -z)', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(p.z).toBeCloseTo(-PLAYER_SPEED * 0.05, 5);
    expect(p.x).toBeCloseTo(0, 5);
  });

  it('спринт быстрее ходьбы', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: true, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(-p.z).toBeGreaterThan(PLAYER_SPEED * 0.05);
  });

  it('не проходит сквозь здание', () => {
    const { state, p, runtimes } = setup();
    p.z = 10;
    const wall = { x: 0, z: 5, w: 20, d: 2 }; // z: 4..6
    runtimes.get('s1')!.input = { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 };
    for (let i = 0; i < 100; i++) tickMovement(state, runtimes, [wall], 0.05, 1000);
    expect(p.z).toBeGreaterThan(6); // остался снаружи (6 + radius)
  });

  it('диагональ нормализуется (не быстрее по диагонали)', () => {
    const { state, p, runtimes } = setup();
    runtimes.get('s1')!.input = { up: true, down: false, left: true, right: false, sprint: false, rotY: 0 };
    tickMovement(state, runtimes, [], 0.05, 1000);
    const dist = Math.hypot(p.x, p.z);
    expect(dist).toBeCloseTo(PLAYER_SPEED * 0.05, 5);
  });

  it('не двигает игрока в машине/тюрьме/мёртвого', () => {
    const { state, p, runtimes } = setup();
    p.mode = 'car';
    runtimes.get('s1')!.input.up = true;
    tickMovement(state, runtimes, [], 0.05, 1000);
    expect(p.z).toBe(0);
  });

  it('регенерирует HP после задержки', () => {
    const { state, p, runtimes } = setup();
    p.hp = 50;
    runtimes.get('s1')!.lastDamageAt = 0;
    tickMovement(state, runtimes, [], 1, 10_000);
    expect(p.hp).toBeGreaterThan(50);
    expect(p.hp).toBeLessThanOrEqual(MAX_HP);
  });

  it('не регенерирует сразу после урона', () => {
    const { state, p, runtimes } = setup();
    p.hp = 50;
    runtimes.get('s1')!.lastDamageAt = 9000;
    tickMovement(state, runtimes, [], 1, 10_000);
    expect(p.hp).toBe(50);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (модули `runtime.js`, `systems/movement.js` отсутствуют).

- [ ] **Step 3: Написать `server/src/runtime.ts`**

```ts
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
```

- [ ] **Step 4: Написать `server/src/systems/movement.ts`**

```ts
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
```

- [ ] **Step 5: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS (db + movement).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): runtime и система движения"
```

---

### Task 7: Система машин

**Files:**
- Create: `server/src/systems/vehicles.ts`
- Test: `server/test/vehicles.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Runtime`, `InputState`; `collidesAny`, `clamp`, `dist2`, `ParkingSpot` (`@mmo/shared`).
- Produces:
  - `interface CarRuntime { emptySince: number }`
  - `tickVehicles(state: GameState, runtimes: Map<string, Runtime>, carRuntime: Map<string, CarRuntime>, colliders: AABB[], dt: number, now: number, parkingSpots: ParkingSpot[]): void`
  - `tryEnterCar(state: GameState, playerId: string): boolean`
  - `tryExitCar(state: GameState, playerId: string): boolean`

- [ ] **Step 1: Написать failing-тест `server/test/vehicles.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../src/systems/vehicles.js';
import { CAR_ACCEL, CAR_MAX_SPEED, CAR_PARK_RETURN_MS, type ParkingSpot } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'driver';
  state.players.set('s1', p);
  const car = new Car();
  car.id = 'car0';
  car.x = 5; car.z = 0;
  state.cars.set('car0', car);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  const carRuntime = new Map<string, CarRuntime>([['car0', { emptySince: 0 }]]);
  const spots: ParkingSpot[] = [{ id: 'car0', x: 100, z: 100 }];
  return { state, p, car, runtimes, carRuntime, spots };
}

describe('машины', () => {
  it('игрок садится в ближайшую свободную машину', () => {
    const { state, p, car } = setup();
    expect(tryEnterCar(state, 's1')).toBe(true);
    expect(p.mode).toBe('car');
    expect(p.carId).toBe('car0');
    expect(car.driverId).toBe('s1');
  });

  it('нельзя сесть в машину дальше CAR_ENTER_DIST', () => {
    const { state, car } = setup();
    car.x = 100;
    expect(tryEnterCar(state, 's1')).toBe(false);
  });

  it('нельзя сесть в занятую машину', () => {
    const { state, car } = setup();
    car.driverId = 'someone';
    expect(tryEnterCar(state, 's1')).toBe(false);
  });

  it('газ разгоняет машину, игрок едет вместе с ней', () => {
    const { state, p, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    runtimes.get('s1')!.input.up = true;
    for (let i = 0; i < 20; i++) tickVehicles(state, runtimes, carRuntime, [], 0.05, i * 50, spots);
    expect(car.speed).toBeCloseTo(Math.min(CAR_MAX_SPEED, CAR_ACCEL * 1), 1);
    expect(car.z).toBeLessThan(0); // едет в -z при rotY=0
    expect(p.x).toBe(car.x);
    expect(p.z).toBe(car.z);
  });

  it('столкновение со зданием останавливает машину', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    tryEnterCar(state, 's1');
    const wall = { x: 5, z: -10, w: 20, d: 2 };
    runtimes.get('s1')!.input.up = true;
    for (let i = 0; i < 200; i++) tickVehicles(state, runtimes, carRuntime, [wall], 0.05, i * 50, spots);
    expect(car.z).toBeGreaterThan(-10);
    expect(car.speed).toBe(0);
  });

  it('выход из машины: игрок рядом, машина свободна', () => {
    const { state, p, car } = setup();
    tryEnterCar(state, 's1');
    expect(tryExitCar(state, 's1')).toBe(true);
    expect(p.mode).toBe('foot');
    expect(car.driverId).toBe('');
    expect(car.speed).toBe(0);
  });

  it('брошенная машина возвращается на парковку через CAR_PARK_RETURN_MS', () => {
    const { state, car, runtimes, carRuntime, spots } = setup();
    car.x = 0; car.z = 0; // уехала с парковки
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000, spots); // фиксирует emptySince
    tickVehicles(state, runtimes, carRuntime, [], 0.05, 1000 + CAR_PARK_RETURN_MS + 1, spots);
    expect(car.x).toBe(100);
    expect(car.z).toBe(100);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`systems/vehicles.js` отсутствует).

- [ ] **Step 3: Написать `server/src/systems/vehicles.ts`**

```ts
import {
  CAR_RADIUS, CAR_MAX_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG, CAR_TURN_RATE,
  CAR_ENTER_DIST, CAR_PARK_RETURN_MS, MAP_HALF,
  collidesAny, clamp, dist2, type AABB, type ParkingSpot,
} from '@mmo/shared';
import type { GameState, Car } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export interface CarRuntime { emptySince: number }

export function tickVehicles(
  state: GameState,
  runtimes: Map<string, Runtime>,
  carRuntime: Map<string, CarRuntime>,
  colliders: AABB[],
  dt: number,
  now: number,
  parkingSpots: ParkingSpot[],
): void {
  state.cars.forEach((car, id) => {
    const crt = carRuntime.get(id);
    if (!crt) return;

    if (car.driverId) {
      crt.emptySince = 0;
      const driver = state.players.get(car.driverId);
      const rt = runtimes.get(car.driverId);
      if (!driver || !rt || driver.mode !== 'car') {
        car.driverId = '';
        car.speed = 0;
        return;
      }
      const inp = rt.input;
      if (inp.up) car.speed = Math.min(CAR_MAX_SPEED, car.speed + CAR_ACCEL * dt);
      else if (inp.down) car.speed = Math.max(0, car.speed - CAR_BRAKE * dt);
      else car.speed = Math.max(0, car.speed - CAR_DRAG * dt);

      const steer = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
      const agility = Math.min(1, car.speed / 3) * (1 - 0.6 * (car.speed / CAR_MAX_SPEED));
      car.rotY += steer * CAR_TURN_RATE * agility * dt;

      if (car.speed > 0) {
        const nx = clamp(car.x - Math.sin(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        const nz = clamp(car.z - Math.cos(car.rotY) * car.speed * dt, -MAP_HALF + CAR_RADIUS, MAP_HALF - CAR_RADIUS);
        if (collidesAny(nx, nz, CAR_RADIUS, colliders)) {
          car.speed = 0;
        } else {
          car.x = nx;
          car.z = nz;
        }
      }
      driver.x = car.x;
      driver.z = car.z;
      driver.rotY = car.rotY;
    } else {
      car.speed = 0;
      if (crt.emptySince === 0) {
        crt.emptySince = now;
      } else if (now - crt.emptySince > CAR_PARK_RETURN_MS) {
        const spot = parkingSpots.find(s => s.id === id);
        if (spot) {
          car.x = spot.x;
          car.z = spot.z;
          car.rotY = 0;
        }
        crt.emptySince = 0;
      }
    }
  });
}

export function tryEnterCar(state: GameState, playerId: string): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'foot') return false;
  let best: Car | null = null;
  let bestD = CAR_ENTER_DIST * CAR_ENTER_DIST;
  state.cars.forEach((car) => {
    if (car.driverId) return;
    const d2 = dist2(p.x, p.z, car.x, car.z);
    if (d2 < bestD) {
      best = car;
      bestD = d2;
    }
  });
  if (!best) return false;
  const chosen: Car = best;
  chosen.driverId = playerId;
  p.mode = 'car';
  p.carId = chosen.id;
  p.x = chosen.x;
  p.z = chosen.z;
  return true;
}

export function tryExitCar(state: GameState, playerId: string): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'car') return false;
  const car = state.cars.get(p.carId);
  if (car) {
    car.driverId = '';
    car.speed = 0;
    p.x = car.x + Math.cos(car.rotY) * 2;
    p.z = car.z - Math.sin(car.rotY) * 2;
  }
  p.mode = 'foot';
  p.carId = '';
  return true;
}
```

Примечание: если линтер ругается на `prefer-const` для `best`, вариант выше (`const chosen: Car = best`) решает проблему потери типа внутри замыкания.

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): машины — аркадная физика, вход/выход, возврат на парковку"
```

---

### Task 8: Система боя

**Files:**
- Create: `server/src/systems/combat.ts`
- Test: `server/test/combat.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Runtime`; `dist2`, константы урона/HP/розыска (`@mmo/shared`).
- Produces:
  - `handleAttack(state: GameState, runtimes: Map<string, Runtime>, attackerId: string, now: number): void`
  - `killPlayer(state: GameState, runtimes: Map<string, Runtime>, killerId: string, victimId: string, now: number): void`
  - `tickRespawn(state: GameState, runtimes: Map<string, Runtime>, map: CityMap, now: number): void`

- [ ] **Step 1: Написать failing-тест `server/test/combat.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { handleAttack, tickRespawn } from '../src/systems/combat.js';
import { PUNCH_DAMAGE, MAX_HP, WANTED_DURATION_MS, DEATH_CASH_LOSS, RESPAWN_DELAY_MS, createCityMap } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const a = new Player(); a.name = 'attacker';
  const v = new Player(); v.name = 'victim';
  // жертва прямо перед атакующим (rotY=0 смотрит в -z)
  a.x = 0; a.z = 0; a.rotY = 0;
  v.x = 0; v.z = -1.5;
  state.players.set('a', a);
  state.players.set('v', v);
  const runtimes = new Map<string, Runtime>([['a', makeRuntime(0)], ['v', makeRuntime(0)]]);
  return { state, a, v, runtimes };
}

describe('бой', () => {
  it('удар наносит урон цели впереди', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('не бьёт цель за спиной', () => {
    const { state, v, runtimes } = setup();
    v.z = 1.5; // сзади
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });

  it('не бьёт дальше PUNCH_RANGE', () => {
    const { state, v, runtimes } = setup();
    v.z = -5;
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });

  it('кулачный кулдаун: второй удар сразу не проходит', () => {
    const { state, v, runtimes } = setup();
    handleAttack(state, runtimes, 'a', 1000);
    handleAttack(state, runtimes, 'a', 1100);
    expect(v.hp).toBe(MAX_HP - PUNCH_DAMAGE);
  });

  it('смерть: потеря 50% наличных, розыск убийцы, респаун', () => {
    const { state, a, v, runtimes } = setup();
    v.hp = PUNCH_DAMAGE;
    v.cash = 400;
    const now = 5000;
    handleAttack(state, runtimes, 'a', now);
    expect(v.mode).toBe('dead');
    expect(v.cash).toBe(Math.floor(400 * (1 - DEATH_CASH_LOSS)));
    expect(a.wantedUntil).toBe(now + WANTED_DURATION_MS);
    expect(runtimes.get('a')!.kills).toBe(1);
    expect(runtimes.get('v')!.deaths).toBe(1);
    // респаун без квартиры — в больнице
    const map = createCityMap();
    tickRespawn(state, runtimes, map, now + RESPAWN_DELAY_MS + 1);
    expect(v.mode).toBe('foot');
    expect(v.hp).toBe(MAX_HP);
    expect(v.x).toBe(map.hospitalDoor.x);
    expect(v.wantedUntil).toBe(0);
  });

  it('нельзя ударить из машины', () => {
    const { state, a, v, runtimes } = setup();
    a.mode = 'car';
    handleAttack(state, runtimes, 'a', 1000);
    expect(v.hp).toBe(MAX_HP);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`systems/combat.js` отсутствует).

- [ ] **Step 3: Написать `server/src/systems/combat.ts`**

```ts
import {
  PUNCH_RANGE, PUNCH_DAMAGE, PUNCH_COOLDOWN_MS, MAX_HP,
  DEATH_CASH_LOSS, WANTED_DURATION_MS, RESPAWN_DELAY_MS,
  dist2, type CityMap, type Point,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export function handleAttack(
  state: GameState,
  runtimes: Map<string, Runtime>,
  attackerId: string,
  now: number,
): void {
  const a = state.players.get(attackerId);
  const art = runtimes.get(attackerId);
  if (!a || !art || a.mode !== 'foot') return;
  if (now - art.lastAttackAt < PUNCH_COOLDOWN_MS) return;

  const fx = -Math.sin(a.rotY);
  const fz = -Math.cos(a.rotY);
  let bestId = '';
  let bestD = PUNCH_RANGE * PUNCH_RANGE;
  state.players.forEach((t, id) => {
    if (id === attackerId) return;
    if (t.mode === 'jail' || t.mode === 'dead') return;
    const d2 = dist2(a.x, a.z, t.x, t.z);
    if (d2 > bestD || d2 === 0) return;
    const len = Math.sqrt(d2);
    const dot = ((t.x - a.x) / len) * fx + ((t.z - a.z) / len) * fz;
    if (dot < 0.3) return;
    bestId = id;
    bestD = d2;
  });
  art.lastAttackAt = now;
  if (!bestId) return;

  const victim = state.players.get(bestId);
  const vrt = runtimes.get(bestId);
  if (!victim || !vrt) return;
  victim.hp -= PUNCH_DAMAGE;
  vrt.lastDamageAt = now;
  if (victim.hp <= 0) killPlayer(state, runtimes, attackerId, bestId, now);
}

export function killPlayer(
  state: GameState,
  runtimes: Map<string, Runtime>,
  killerId: string,
  victimId: string,
  now: number,
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
  victim.mode = 'dead';
  victim.hp = 0;
  victim.cash = Math.floor(victim.cash * (1 - DEATH_CASH_LOSS));
  victim.cargo = false;
  victim.deliveryTarget = '';
  vrt.deaths++;
  vrt.respawnAt = now + RESPAWN_DELAY_MS;

  if (killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    const krt = runtimes.get(killerId);
    if (killer) killer.wantedUntil = now + WANTED_DURATION_MS;
    if (krt) krt.kills++;
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
    let door: Point = map.hospitalDoor;
    state.apartments.forEach((apt) => {
      if (apt.rentedBy === p.name) door = { x: apt.doorX, z: apt.doorZ };
    });
    p.x = door.x;
    p.z = door.z;
    p.hp = MAX_HP;
    p.mode = 'foot';
    p.wantedUntil = 0;
    p.rotY = 0;
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): кулачный бой, смерть, розыск, респаун"
```

---

### Task 9: Система полиции

**Files:**
- Create: `server/src/systems/police.ts`
- Test: `server/test/police.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Runtime`; `dist2`, `CityMap`, константы ареста/зарплаты (`@mmo/shared`).
- Produces: `tickPolice(state: GameState, runtimes: Map<string, Runtime>, now: number, dt: number, map: CityMap): void` — зарплаты копов, накопление ареста, тюрьма, освобождение.

- [ ] **Step 1: Написать failing-тест `server/test/police.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tickPolice } from '../src/systems/police.js';
import {
  ARREST_TIME_MS, ARREST_CASH_LOSS, ARREST_BONUS, JAIL_TIME_MS,
  COP_SALARY, COP_SALARY_INTERVAL_MS, createCityMap,
} from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const cop = new Player(); cop.name = 'cop'; cop.role = 'cop'; cop.x = 0; cop.z = 0;
  const crim = new Player(); crim.name = 'crim'; crim.x = 1; crim.z = 0;
  crim.wantedUntil = 100_000; crim.cash = 400;
  state.players.set('c', cop);
  state.players.set('k', crim);
  const runtimes = new Map<string, Runtime>([['c', makeRuntime(0)], ['k', makeRuntime(0)]]);
  return { state, cop, crim, runtimes };
}

describe('полиция', () => {
  it('арест после ARREST_TIME_MS рядом с копом: тюрьма, штраф, бонус копу', () => {
    const { state, cop, crim, runtimes } = setup();
    const copCash = cop.cash;
    // три тика по 1 секунде
    tickPolice(state, runtimes, 1000, 1, map);
    tickPolice(state, runtimes, 2000, 1, map);
    expect(crim.mode).toBe('foot'); // ещё не арестован
    tickPolice(state, runtimes, 3000, 1, map);
    expect(crim.mode).toBe('jail');
    expect(crim.x).toBe(map.jailCell.x);
    expect(crim.cash).toBe(Math.floor(400 * (1 - ARREST_CASH_LOSS)));
    expect(crim.wantedUntil).toBe(0);
    expect(crim.jailUntil).toBe(3000 + JAIL_TIME_MS);
    expect(cop.cash).toBe(copCash + ARREST_BONUS);
  });

  it('прогресс ареста сбрасывается, если коп отошёл', () => {
    const { state, cop, crim, runtimes } = setup();
    tickPolice(state, runtimes, 1000, 1, map);
    tickPolice(state, runtimes, 2000, 1, map);
    cop.x = 100; // коп ушёл
    tickPolice(state, runtimes, 3000, 1, map);
    expect(crim.mode).toBe('foot');
    expect(runtimes.get('k')!.arrestProgress).toBe(0);
  });

  it('коп в розыске не может арестовывать', () => {
    const { state, cop, crim, runtimes } = setup();
    cop.wantedUntil = 200_000;
    for (let i = 0; i < 5; i++) tickPolice(state, runtimes, 1000 + i * 1000, 1, map);
    expect(crim.mode).toBe('foot');
  });

  it('освобождение из тюрьмы после JAIL_TIME_MS', () => {
    const { state, crim, runtimes } = setup();
    crim.mode = 'jail';
    crim.jailUntil = 5000;
    crim.wantedUntil = 0;
    tickPolice(state, runtimes, 5001, 0.05, map);
    expect(crim.mode).toBe('foot');
    expect(crim.x).toBe(map.policeDoor.x);
  });

  it('зарплата копа каждые COP_SALARY_INTERVAL_MS', () => {
    const { state, cop, crim, runtimes } = setup();
    crim.wantedUntil = 0; // убрать арест из картины
    cop.cash = 0;
    tickPolice(state, runtimes, COP_SALARY_INTERVAL_MS + 1, 0.05, map);
    expect(cop.cash).toBe(COP_SALARY);
    expect(runtimes.get('c')!.nextSalaryAt).toBe(COP_SALARY_INTERVAL_MS + 1 + COP_SALARY_INTERVAL_MS);
  });

  it('гражданин зарплату не получает', () => {
    const { state, crim, runtimes } = setup();
    crim.wantedUntil = 0;
    crim.cash = 0;
    tickPolice(state, runtimes, COP_SALARY_INTERVAL_MS + 1, 0.05, map);
    expect(crim.cash).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`systems/police.js` отсутствует).

- [ ] **Step 3: Написать `server/src/systems/police.ts`**

```ts
import {
  ARREST_RANGE, ARREST_TIME_MS, ARREST_CASH_LOSS, ARREST_BONUS, JAIL_TIME_MS,
  COP_SALARY, COP_SALARY_INTERVAL_MS, MAX_HP,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

export function tickPolice(
  state: GameState,
  runtimes: Map<string, Runtime>,
  now: number,
  dt: number,
  map: CityMap,
): void {
  // Зарплаты
  state.players.forEach((p, id) => {
    const rt = runtimes.get(id);
    if (!rt) return;
    if (p.role === 'cop' && p.mode !== 'dead' && now >= rt.nextSalaryAt) {
      p.cash += COP_SALARY;
      rt.nextSalaryAt = now + COP_SALARY_INTERVAL_MS;
    }
  });

  // Аресты
  state.players.forEach((crim, crimId) => {
    const crt = runtimes.get(crimId);
    if (!crt) return;
    const wanted = crim.wantedUntil > now && crim.mode !== 'jail' && crim.mode !== 'dead';
    if (!wanted) {
      crt.arrestProgress = 0;
      return;
    }
    let copId = '';
    state.players.forEach((cop, id) => {
      if (copId) return;
      if (cop.role !== 'cop' || cop.wantedUntil > now) return;
      if (cop.mode !== 'foot' && cop.mode !== 'car') return;
      if (dist2(cop.x, cop.z, crim.x, crim.z) < ARREST_RANGE * ARREST_RANGE) copId = id;
    });
    if (!copId) {
      crt.arrestProgress = 0;
      return;
    }
    crt.arrestProgress += dt * 1000;
    if (crt.arrestProgress < ARREST_TIME_MS) return;

    if (crim.mode === 'car') {
      const car = state.cars.get(crim.carId);
      if (car) {
        car.driverId = '';
        car.speed = 0;
      }
      crim.carId = '';
    }
    crim.mode = 'jail';
    crim.x = map.jailCell.x;
    crim.z = map.jailCell.z;
    crim.jailUntil = now + JAIL_TIME_MS;
    crim.wantedUntil = 0;
    crim.cash = Math.floor(crim.cash * (1 - ARREST_CASH_LOSS));
    crim.cargo = false;
    crim.deliveryTarget = '';
    crt.arrestProgress = 0;
    const cop = state.players.get(copId);
    if (cop) cop.cash += ARREST_BONUS;
  });

  // Освобождение
  state.players.forEach((p) => {
    if (p.mode === 'jail' && now >= p.jailUntil) {
      p.mode = 'foot';
      p.x = map.policeDoor.x;
      p.z = map.policeDoor.z;
      p.hp = MAX_HP;
    }
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): полиция — аресты, тюрьма, зарплаты"
```

---

### Task 10: Экономика — доставка

**Files:**
- Create: `server/src/systems/economy.ts`
- Test: `server/test/economy.test.ts`

**Interfaces:**
- Consumes: `GameState`; `dist2`, `CityMap`, константы доставки (`@mmo/shared`).
- Produces:
  - `tryStartDelivery(state: GameState, playerId: string, map: CityMap, now: number): boolean`
  - `tickDelivery(state: GameState, map: CityMap, now: number): void`

- [ ] **Step 1: Написать failing-тест `server/test/economy.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player, Car } from '../src/schema/GameState.js';
import { tryStartDelivery, tickDelivery } from '../src/systems/economy.js';
import { DELIVERY_REWARD, DELIVERY_TIME_MS, createCityMap } from '@mmo/shared';

const map = createCityMap();

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'courier';
  p.mode = 'car';
  p.carId = 'car0';
  p.x = map.warehouse.x;
  p.z = map.warehouse.z;
  p.cash = 0;
  state.players.set('s1', p);
  const car = new Car();
  car.id = 'car0';
  car.x = p.x; car.z = p.z;
  car.driverId = 's1';
  state.cars.set('car0', car);
  return { state, p, car };
}

describe('доставка', () => {
  it('взятие груза на складе в машине', () => {
    const { state, p } = setup();
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(true);
    expect(p.cargo).toBe(true);
    expect(map.deliveryTargets.map(t => t.id)).toContain(p.deliveryTarget);
    expect(p.deliveryDeadline).toBe(1000 + DELIVERY_TIME_MS);
  });

  it('нельзя взять груз пешком', () => {
    const { state, p } = setup();
    p.mode = 'foot';
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(false);
  });

  it('нельзя взять груз вдали от склада', () => {
    const { state, p } = setup();
    p.x = 0; p.z = 0;
    expect(tryStartDelivery(state, 's1', map, 1000)).toBe(false);
  });

  it('доставка в точку: награда, груз снят', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    const target = map.deliveryTargets.find(t => t.id === p.deliveryTarget)!;
    p.x = target.x; p.z = target.z;
    tickDelivery(state, map, 2000);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(DELIVERY_REWARD);
    expect(p.deliveryTarget).toBe('');
  });

  it('таймаут: груз пропадает без награды', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    tickDelivery(state, map, 1000 + DELIVERY_TIME_MS + 1);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(0);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`systems/economy.js` отсутствует).

- [ ] **Step 3: Написать `server/src/systems/economy.ts`**

```ts
import {
  DELIVERY_REWARD, DELIVERY_TIME_MS, DELIVERY_PICKUP_DIST, DELIVERY_DROP_DIST,
  dist2, type CityMap,
} from '@mmo/shared';
import type { GameState } from '../schema/GameState.js';

export function tryStartDelivery(
  state: GameState,
  playerId: string,
  map: CityMap,
  now: number,
): boolean {
  const p = state.players.get(playerId);
  if (!p || p.mode !== 'car' || p.cargo) return false;
  if (dist2(p.x, p.z, map.warehouse.x, map.warehouse.z) > DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) return false;
  const t = map.deliveryTargets[Math.floor(Math.random() * map.deliveryTargets.length)];
  p.cargo = true;
  p.deliveryTarget = t.id;
  p.deliveryDeadline = now + DELIVERY_TIME_MS;
  return true;
}

export function tickDelivery(state: GameState, map: CityMap, now: number): void {
  state.players.forEach((p) => {
    if (!p.cargo) return;
    if (now > p.deliveryDeadline) {
      p.cargo = false;
      p.deliveryTarget = '';
      return;
    }
    const t = map.deliveryTargets.find(t => t.id === p.deliveryTarget);
    if (t && dist2(p.x, p.z, t.x, t.z) < DELIVERY_DROP_DIST * DELIVERY_DROP_DIST) {
      p.cargo = false;
      p.deliveryTarget = '';
      p.cash += DELIVERY_REWARD;
    }
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): работа доставки"
```

---

### Task 11: Недвижимость — аренда и сейф

**Files:**
- Create: `server/src/systems/housing.ts`
- Test: `server/test/housing.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Runtime`; `dist2`, константы аренды (`@mmo/shared`).
- Produces:
  - `tryRent(state: GameState, runtimes: Map<string, Runtime>, playerId: string, now: number): 'ok' | 'too_far' | 'taken' | 'no_money'`
  - `adjustSafe(state: GameState, playerId: string, amount: number): boolean` — `amount > 0` депозит, `< 0` снятие
  - `tickRent(state: GameState, runtimes: Map<string, Runtime>, now: number): void`

- [ ] **Step 1: Написать failing-тест `server/test/housing.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { GameState, Player, Apartment } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tryRent, adjustSafe, tickRent } from '../src/systems/housing.js';
import { RENT_PRICE, RENT_INTERVAL_MS, SAFE_LIMIT } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'tenant';
  p.cash = 500;
  state.players.set('s1', p);
  const apt = new Apartment();
  apt.id = 'apt0';
  apt.doorX = 10; apt.doorZ = 10;
  state.apartments.set('apt0', apt);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  // игрок у двери
  p.x = 10; p.z = 11;
  return { state, p, apt, runtimes };
}

describe('аренда и сейф', () => {
  it('аренда у свободной двери: деньги списаны, квартира занята', () => {
    const { state, p, apt, runtimes } = setup();
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('ok');
    expect(p.cash).toBe(500 - RENT_PRICE);
    expect(apt.rentedBy).toBe('tenant');
    expect(p.apt).toBe('apt0');
    expect(runtimes.get('s1')!.nextRentAt).toBe(1000 + RENT_INTERVAL_MS);
  });

  it('нельзя арендовать вдали от двери', () => {
    const { state, p, runtimes } = setup();
    p.x = 100; p.z = 100;
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('too_far');
  });

  it('нельзя арендовать занятую квартиру', () => {
    const { state, apt, runtimes } = setup();
    apt.rentedBy = 'other';
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('taken');
  });

  it('нельзя арендовать без денег', () => {
    const { state, p, runtimes } = setup();
    p.cash = RENT_PRICE - 1;
    expect(tryRent(state, runtimes, 's1', 1000)).toBe('no_money');
  });

  it('депозит и снятие у своей двери с лимитом сейфа', () => {
    const { state, p } = setup();
    p.apt = 'apt0';
    state.apartments.get('apt0')!.rentedBy = 'tenant';
    expect(adjustSafe(state, 's1', 300)).toBe(true);
    expect(p.cash).toBe(200);
    expect(p.safe).toBe(300);
    expect(adjustSafe(state, 's1', -100)).toBe(true);
    expect(p.cash).toBe(300);
    expect(p.safe).toBe(200);
    // лимит сейфа: допускается частичный депозит до лимита
    p.safe = SAFE_LIMIT - 50;
    expect(adjustSafe(state, 's1', 300)).toBe(true);
    expect(p.safe).toBe(SAFE_LIMIT);
    expect(p.cash).toBe(250);
    // сейф полон — депозит отклонён
    expect(adjustSafe(state, 's1', 100)).toBe(false);
  });

  it('нельзя пользоваться чужим сейфом', () => {
    const { state } = setup();
    state.apartments.get('apt0')!.rentedBy = 'other';
    expect(adjustSafe(state, 's1', 100)).toBe(false);
  });

  it('списание аренды и выселение при нехватке денег', () => {
    const { state, p, apt, runtimes } = setup();
    tryRent(state, runtimes, 's1', 1000);
    // первая оплата прошла, следующая в 1000+RENT_INTERVAL_MS
    p.cash = 10; // не хватит
    tickRent(state, runtimes, 1000 + RENT_INTERVAL_MS + 1);
    expect(apt.rentedBy).toBe('');
    expect(p.apt).toBe('');
  });

  it('списание аренды при наличии денег', () => {
    const { state, p, apt, runtimes } = setup();
    tryRent(state, runtimes, 's1', 1000);
    const before = p.cash;
    tickRent(state, runtimes, 1000 + RENT_INTERVAL_MS + 1);
    expect(p.cash).toBe(before - RENT_PRICE);
    expect(apt.rentedBy).toBe('tenant');
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npm run test -w server`
Expected: FAIL (`systems/housing.js` отсутствует).

- [ ] **Step 3: Написать `server/src/systems/housing.ts`**

```ts
import { RENT_PRICE, RENT_INTERVAL_MS, SAFE_LIMIT, DOOR_DIST, dist2 } from '@mmo/shared';
import type { GameState, Apartment } from '../schema/GameState.js';
import type { Runtime } from '../runtime.js';

function nearApartment(state: GameState, x: number, z: number): Apartment | null {
  let found: Apartment | null = null;
  state.apartments.forEach((a) => {
    if (found) return;
    if (dist2(x, z, a.doorX, a.doorZ) < DOOR_DIST * DOOR_DIST) found = a;
  });
  return found;
}

export function tryRent(
  state: GameState,
  runtimes: Map<string, Runtime>,
  playerId: string,
  now: number,
): 'ok' | 'too_far' | 'taken' | 'no_money' {
  const p = state.players.get(playerId);
  if (!p) return 'too_far';
  const apt = nearApartment(state, p.x, p.z);
  if (!apt) return 'too_far';
  if (apt.rentedBy) return 'taken';
  if (p.cash < RENT_PRICE) return 'no_money';
  p.cash -= RENT_PRICE;
  apt.rentedBy = p.name;
  p.apt = apt.id;
  const rt = runtimes.get(playerId);
  if (rt) rt.nextRentAt = now + RENT_INTERVAL_MS;
  return 'ok';
}

export function adjustSafe(state: GameState, playerId: string, amount: number): boolean {
  const p = state.players.get(playerId);
  if (!p || !p.apt) return false;
  const apt = state.apartments.get(p.apt);
  if (!apt || apt.rentedBy !== p.name) return false;
  if (dist2(p.x, p.z, apt.doorX, apt.doorZ) > DOOR_DIST * DOOR_DIST) return false;
  if (amount > 0) {
    const v = Math.min(amount, p.cash, SAFE_LIMIT - p.safe);
    if (v <= 0) return false;
    p.cash -= v;
    p.safe += v;
    return true;
  }
  if (amount < 0) {
    const v = Math.min(-amount, p.safe);
    if (v <= 0) return false;
    p.safe -= v;
    p.cash += v;
    return true;
  }
  return false;
}

export function tickRent(state: GameState, runtimes: Map<string, Runtime>, now: number): void {
  state.players.forEach((p, id) => {
    if (!p.apt) return;
    const rt = runtimes.get(id);
    if (!rt || now < rt.nextRentAt) return;
    rt.nextRentAt = now + RENT_INTERVAL_MS;
    if (p.cash >= RENT_PRICE) {
      p.cash -= RENT_PRICE;
    } else {
      const apt = state.apartments.get(p.apt);
      if (apt) apt.rentedBy = '';
      p.apt = '';
    }
  });
}
```

- [ ] **Step 4: Запустить тесты — должны пройти**

Run: `npm run test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): аренда квартир и сейф"
```

---

### Task 12: Комната CityRoom + входная точка сервера + интеграционный тест

**Files:**
- Create: `server/src/rooms/CityRoom.ts`
- Create: `server/src/app.ts`
- Create: `server/src/index.ts`
- Test: `server/test/room.integration.test.ts`

**Interfaces:**
- Consumes: все системы задач 6–11, `GameDB` (Task 5), `createCityMap` (`@mmo/shared`).
- Produces:
  - `class CityRoom extends Room<GameState>` — комната `city`, `maxClients = MAX_PLAYERS`.
  - Сообщения клиент→сервер: `'input'` `{up,down,left,right,sprint,rotY}`, `'attack'`, `'interact'`, `'deposit'` `{amount}`, `'withdraw'` `{amount}`.
  - Сообщения сервер→клиент: `'openSafe'` (при interact у своей двери).
  - Опции входа: `{ name: string, role: 'citizen' | 'cop' }`.
  - `createGameServer(): Server` из `app.ts`.

Логика `interact` (приоритет сверху вниз):
1. игрок в машине → рядом со складом и без груза: `tryStartDelivery`; иначе `tryExitCar`.
2. игрок пешком рядом с дверью квартиры → своя: отправить `'openSafe'`; чужая/свободная: `tryRent`.
3. игрок пешком → `tryEnterCar`.

- [ ] **Step 1: Написать `server/src/rooms/CityRoom.ts`**

```ts
import { Room, type Client } from 'colyseus';
import {
  TICK_RATE, MAX_PLAYERS, COP_LIMIT, DELIVERY_PICKUP_DIST, DOOR_DIST,
  createCityMap, dist2, type AABB, type CityMap,
} from '@mmo/shared';
import { GameState, Player, Car, Apartment } from '../schema/GameState.js';
import { makeRuntime, type Runtime } from '../runtime.js';
import { GameDB } from '../db.js';
import { tickMovement } from '../systems/movement.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../systems/vehicles.js';
import { handleAttack, tickRespawn } from '../systems/combat.js';
import { tickPolice } from '../systems/police.js';
import { tryStartDelivery, tickDelivery } from '../systems/economy.js';
import { tryRent, adjustSafe, tickRent } from '../systems/housing.js';

const SAVE_INTERVAL_MS = 5000;

export class CityRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  private map!: CityMap;
  private colliders!: AABB[];
  private db!: GameDB;
  private runtimes = new Map<string, Runtime>();
  private carRuntime = new Map<string, CarRuntime>();
  private lastSaveAt = 0;

  onCreate(): void {
    this.map = createCityMap();
    this.colliders = this.map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
    this.db = new GameDB(process.env.GAME_DB ?? 'game.db');
    this.setState(new GameState());

    for (const spot of this.map.parkingSpots) {
      const car = new Car();
      car.id = spot.id;
      car.x = spot.x;
      car.z = spot.z;
      this.state.cars.set(spot.id, car);
      this.carRuntime.set(spot.id, { emptySince: 0 });
    }
    for (const door of this.map.apartments) {
      const a = new Apartment();
      a.id = door.id;
      a.doorX = door.x;
      a.doorZ = door.z;
      this.state.apartments.set(door.id, a);
    }

    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / TICK_RATE);

    this.onMessage('input', (client, data) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      rt.input = {
        up: !!data.up, down: !!data.down, left: !!data.left, right: !!data.right,
        sprint: !!data.sprint, rotY: Number(data.rotY) || 0,
      };
    });
    this.onMessage('attack', (client) => {
      handleAttack(this.state, this.runtimes, client.sessionId, Date.now());
    });
    this.onMessage('interact', (client) => this.handleInteract(client));
    this.onMessage('deposit', (client, data) => {
      adjustSafe(this.state, client.sessionId, Math.abs(Number(data?.amount) || 0));
    });
    this.onMessage('withdraw', (client, data) => {
      adjustSafe(this.state, client.sessionId, -Math.abs(Number(data?.amount) || 0));
    });
  }

  onJoin(client: Client, options: { name?: string; role?: string }): void {
    const name = String(options?.name ?? '').slice(0, 16) || `p${client.sessionId.slice(0, 6)}`;
    let role: 'citizen' | 'cop' = options?.role === 'cop' ? 'cop' : 'citizen';
    if (role === 'cop') {
      let cops = 0;
      this.state.players.forEach(pl => { if (pl.role === 'cop') cops++; });
      if (cops >= COP_LIMIT) role = 'citizen';
    }
    const rec = this.db.load(name);

    const p = new Player();
    p.name = name;
    p.role = role;
    const door = role === 'cop' ? this.map.policeDoor : this.map.hospitalDoor;
    p.x = door.x + Math.random() * 4 - 2;
    p.z = door.z + Math.random() * 2; // только в сторону от здания, чтобы не заспавнить в коллизии
    p.cash = rec.cash;
    p.safe = rec.safe;
    if (rec.apt) {
      const apt = this.state.apartments.get(rec.apt);
      if (apt && (!apt.rentedBy || apt.rentedBy === name)) {
        apt.rentedBy = name;
        p.apt = rec.apt;
      }
    }
    this.state.players.set(client.sessionId, p);

    const rt = makeRuntime(Date.now());
    rt.kills = rec.kills;
    rt.deaths = rec.deaths;
    this.runtimes.set(client.sessionId, rt);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    try {
      if (consented) throw new Error('consented leave');
      await this.allowReconnection(client, 10);
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  onDispose(): void {
    this.state.players.forEach((_p, id) => this.savePlayer(id));
    this.db.close();
  }

  private removePlayer(id: string): void {
    const p = this.state.players.get(id);
    if (p) {
      if (p.mode === 'car') {
        const car = this.state.cars.get(p.carId);
        if (car) {
          car.driverId = '';
          car.speed = 0;
        }
      }
      this.savePlayer(id);
      this.state.players.delete(id);
    }
    this.runtimes.delete(id);
  }

  private savePlayer(id: string): void {
    const p = this.state.players.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    this.db.save({ name: p.name, cash: p.cash, safe: p.safe, apt: p.apt, kills: rt.kills, deaths: rt.deaths });
  }

  private handleInteract(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (p.mode === 'car') {
      if (!p.cargo && dist2(p.x, p.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) {
        tryStartDelivery(this.state, client.sessionId, this.map, Date.now());
        return;
      }
      tryExitCar(this.state, client.sessionId);
      return;
    }
    if (p.mode !== 'foot') return;
    let nearApt: Apartment | null = null;
    this.state.apartments.forEach((a) => {
      if (nearApt) return;
      if (dist2(p.x, p.z, a.doorX, a.doorZ) < DOOR_DIST * DOOR_DIST) nearApt = a;
    });
    if (nearApt) {
      const apt: Apartment = nearApt;
      if (apt.rentedBy === p.name) client.send('openSafe');
      else tryRent(this.state, this.runtimes, client.sessionId, Date.now());
      return;
    }
    tryEnterCar(this.state, client.sessionId);
  }

  private tick(dt: number): void {
    const now = Date.now();
    this.state.serverTime = now;
    tickMovement(this.state, this.runtimes, this.colliders, dt, now);
    tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots);
    tickRespawn(this.state, this.runtimes, this.map, now);
    tickPolice(this.state, this.runtimes, now, dt, this.map);
    tickDelivery(this.state, this.map, now);
    tickRent(this.state, this.runtimes, now);
    if (now - this.lastSaveAt > SAVE_INTERVAL_MS) {
      this.state.players.forEach((_p, id) => this.savePlayer(id));
      this.lastSaveAt = now;
    }
  }
}
```

- [ ] **Step 2: Написать `server/src/app.ts` и `server/src/index.ts`**

`server/src/app.ts`:

```ts
import { Server } from 'colyseus';
import { createServer } from 'node:http';
import express from 'express';
import { CityRoom } from './rooms/CityRoom.js';

export function createGameServer(): Server {
  const app = express();
  app.get('/', (_req, res) => res.send('mmo2game server'));
  const gameServer = new Server({ server: createServer(app) });
  gameServer.define('city', CityRoom);
  return gameServer;
}
```

`server/src/index.ts`:

```ts
import { createGameServer } from './app.js';

const port = Number(process.env.PORT ?? 2567);

createGameServer().listen(port).then(() => {
  console.log(`[server] ws://localhost:${port}`);
});
```

- [ ] **Step 3: Написать интеграционный тест `server/test/room.integration.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

describe('CityRoom (integration)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    process.env.GAME_DB = ':memory:';
    const gameServer = new Server();
    gameServer.define('city', CityRoom);
    testServer = await boot(gameServer);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  it('игрок заходит и появляется в состоянии комнаты', async () => {
    const room = await testServer.createRoom<GameState>({ name: 'city' }) as any;
    const client = await testServer.connectTo(room, { name: 'int1', role: 'citizen' });
    expect(room.state.players.size).toBe(1);
    const p = room.state.players.get(client.sessionId);
    expect(p.name).toBe('int1');
    expect(p.cash).toBe(500);
  });

  it('ввод двигает игрока', async () => {
    const room = await testServer.createRoom<GameState>({ name: 'city' }) as any;
    const client = await testServer.connectTo(room, { name: 'int2', role: 'citizen' });
    const before = room.state.players.get(client.sessionId).z;
    client.send('input', { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 });
    await new Promise(r => setTimeout(r, 500));
    const after = room.state.players.get(client.sessionId).z;
    expect(after).toBeLessThan(before);
  });

  it('лимит копов: 21-й коп становится гражданином', async () => {
    const room = await testServer.createRoom<GameState>({ name: 'city' }) as any;
    const clients = [];
    for (let i = 0; i < 21; i++) {
      clients.push(await testServer.connectTo(room, { name: `cop${i}`, role: 'cop' }));
    }
    const roles = new Set<string>();
    room.state.players.forEach((p: any) => roles.add(p.role));
    let cops = 0;
    room.state.players.forEach((p: any) => { if (p.role === 'cop') cops++; });
    expect(cops).toBe(20);
  });
});
```

Замечание: если у `@colyseus/testing` в установленной версии сигнатура отличается (`connectTo('city', options)` вместо `connectTo(room, options)`), поправить вызовы под актуальный API пакета — тесты должны остаться семантически теми же.

- [ ] **Step 4: Запустить все тесты сервера**

Run: `npm run test -w server`
Expected: PASS (unit + integration). Если тест на лимит копов флаки из-за переподключения — увеличить таймаут; проблема решается последовательным `await` в цикле (он уже есть).

- [ ] **Step 5: Проверить запуск сервера вручную**

Run: `cd server && npx tsx src/index.ts & sleep 3 && curl -s http://localhost:2567/ && kill %1`
Expected: ответ `mmo2game server`, в логах `[server] ws://localhost:2567`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): комната CityRoom, входная точка, интеграционные тесты"
```

---

### Task 13: Клиент — скелет, подключение, рендер города

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/style.css`
- Create: `client/src/net.ts`
- Create: `client/src/world.ts`
- Create: `client/src/main.ts`

**Interfaces:**
- Consumes: `@mmo/shared` (`createCityMap`, `ROADS`, `ROAD_WIDTH`, `MAP_HALF`), комната `city` (Task 12).
- Produces:
  - `connect(name: string, role: string): Promise<Room>` из `net.ts`.
  - `buildWorld(scene: THREE.Scene): CityMap` из `world.ts`.
  - Точка входа `main.ts` с экраном входа (`#join`), canvas и HUD-контейнерами.

- [ ] **Step 1: Создать файлы пакета**

`client/package.json`:

```json
{
  "name": "@mmo/client",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@mmo/shared": "*",
    "colyseus.js": "^0.16.0",
    "three": "^0.169.0"
  },
  "devDependencies": {
    "@types/three": "^0.169.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`client/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
});
```

- [ ] **Step 2: Написать `client/index.html` и `client/src/style.css`**

`client/index.html`:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MMO City</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
  <div id="join">
    <h1>MMO City</h1>
    <input id="nameInput" maxlength="16" placeholder="Ник" />
    <div class="roles">
      <button id="joinCitizen">Гражданин</button>
      <button id="joinCop">Полицейский</button>
    </div>
    <div id="joinError"></div>
  </div>

  <div id="hud" class="hidden">
    <div id="stats"></div>
    <div id="banner" class="hidden"></div>
    <div id="prompt"></div>
    <div id="safeDialog" class="hidden">
      <div>Сейф</div>
      <button id="dep100">+100</button>
      <button id="depAll">Всё</button>
      <button id="wd100">−100</button>
      <button id="wdAll">Снять всё</button>
      <button id="safeClose">Закрыть</button>
    </div>
  </div>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`client/src/style.css`:

```css
html, body { margin: 0; height: 100%; overflow: hidden; font-family: sans-serif; background: #000; }
canvas { display: block; }
.hidden { display: none !important; }

#join {
  position: fixed; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: #1a1a2e; color: #eee; z-index: 10;
}
#nameInput { padding: 10px; font-size: 18px; }
.roles { display: flex; gap: 12px; }
button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
#joinError { color: #ff6666; }

#hud { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
#stats {
  position: absolute; top: 10px; left: 10px; color: #fff;
  background: rgba(0,0,0,.5); padding: 8px 12px; border-radius: 6px;
  font-size: 14px; white-space: pre;
}
#banner {
  position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
  color: #ff4444; font-size: 22px; font-weight: bold;
  background: rgba(0,0,0,.5); padding: 6px 16px; border-radius: 6px;
}
#prompt {
  position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
  color: #fff; font-size: 18px; background: rgba(0,0,0,.5);
  padding: 6px 16px; border-radius: 6px;
}
#safeDialog {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: rgba(20,20,40,.95); color: #fff; padding: 20px;
  border-radius: 8px; display: flex; flex-direction: column; gap: 8px;
  pointer-events: auto;
}
```

- [ ] **Step 3: Написать `client/src/net.ts`**

```ts
import { Client, type Room } from 'colyseus.js';

export async function connect(name: string, role: string): Promise<Room> {
  const url = (import.meta as any).env?.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
  const client = new Client(url);
  return client.joinOrCreate('city', { name, role });
}
```

- [ ] **Step 4: Написать `client/src/world.ts`**

```ts
import * as THREE from 'three';
import { createCityMap, ROADS, ROAD_WIDTH, MAP_HALF, type CityMap, type Point } from '@mmo/shared';

export function buildWorld(scene: THREE.Scene): CityMap {
  const map = createCityMap();

  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 200, 600);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(100, 200, 50);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
    new THREE.MeshLambertMaterial({ color: 0x4a7c3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  for (const at of ROADS) {
    for (const vertical of [true, false]) {
      const geo = new THREE.PlaneGeometry(
        vertical ? ROAD_WIDTH : MAP_HALF * 2,
        vertical ? MAP_HALF * 2 : ROAD_WIDTH,
      );
      const road = new THREE.Mesh(geo, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(vertical ? at : 0, 0.01, vertical ? 0 : at);
      scene.add(road);
    }
  }

  for (const b of map.buildings) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshLambertMaterial({ color: b.color }),
    );
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
  }

  const doorMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
  for (const a of map.apartments) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.3), doorMat);
    m.position.set(a.x, 1.25, a.z);
    scene.add(m);
  }

  const mark = (p: Point, color: number, size = 3) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(size, size, 0.2, 24),
      new THREE.MeshLambertMaterial({ color }),
    );
    m.position.set(p.x, 0.1, p.z);
    scene.add(m);
  };
  mark(map.warehouse, 0xff8800);
  for (const t of map.deliveryTargets) mark(t, 0x00cccc);
  mark(map.hospitalDoor, 0xffffff, 2);
  mark(map.policeDoor, 0x2244ff, 2);

  return map;
}
```

- [ ] **Step 5: Написать `client/src/main.ts` (пока без аватаров и UI — заглушки заменятся в задачах 14–15)**

```ts
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect } from './net.js';
import type { Room } from 'colyseus.js';
import type { CityMap } from '@mmo/shared';

const joinScreen = document.getElementById('join')!;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;

async function start(role: string): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Введи ник';
    return;
  }
  let room: Room;
  try {
    room = await connect(name, role);
  } catch {
    joinError.textContent = 'Не удалось подключиться (сервер полон или недоступен)';
    return;
  }
  joinScreen.style.display = 'none';
  document.getElementById('hud')!.classList.remove('hidden');
  bootGame(room);
}

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const map: CityMap = buildWorld(scene);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // avatars, input, ui подключаются в задачах 14–15:
  // const avatars = new Avatars(scene, room);
  // const input = new InputController(room, renderer.domElement);
  // const ui = new UI(room, map);
  void map;

  const me = () => room.state.players.get(room.sessionId) as any;
  renderer.setAnimationLoop(() => {
    const p = me();
    if (p) {
      camera.position.set(p.x, 30, p.z + 25);
      camera.lookAt(p.x, 0, p.z);
    }
    renderer.render(scene, camera);
  });
}

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
```

- [ ] **Step 6: Установить зависимости и собрать**

Run: `npm install && npm run build -w client`
Expected: сборка проходит без ошибок TypeScript и Vite.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(client): скелет клиента, подключение, рендер города"
```

---

### Task 14: Клиент — аватары, интерполяция, камера, ввод

**Files:**
- Create: `client/src/avatars.ts`
- Create: `client/src/input.ts`
- Create: `client/src/camera.ts`
- Modify: `client/src/main.ts` (подключить Avatars, InputController, updateCamera)

**Interfaces:**
- Consumes: `Room` из colyseus.js, схемы состояния (Task 4), сообщение `'input'` (Task 12).
- Produces:
  - `class Avatars { constructor(scene: THREE.Scene, room: Room); readonly serverOffset: number; update(dt: number): void }` — создаёт/удаляет меши игроков и машин, интерполирует позиции, показывает маркер розыска, цвет копа, прячет игрока в машине/мёртвого.
  - `class InputController { yaw: number; constructor(room: Room, dom: HTMLElement) }` — шлёт `'input'` каждые 50 мс, клик (pointer lock) → `'attack'`, `KeyE` → `'interact'`.
  - `updateCamera(camera: THREE.PerspectiveCamera, room: Room, yaw: number): void` — камера от третьего лица.
- Синхронизация времени: `serverOffset = room.state.serverTime - Date.now()` при создании; серверное «сейчас» = `Date.now() + serverOffset`.

- [ ] **Step 1: Написать `client/src/avatars.ts`**

```ts
import * as THREE from 'three';
import type { Room } from 'colyseus.js';

interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  marker: THREE.Mesh;
}

function makePlayerMesh(): PlayerMesh {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x888888 }),
  );
  body.position.y = 0.9;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    new THREE.MeshLambertMaterial({ color: 0xffcc99 }),
  );
  head.position.y = 1.9;
  group.add(head);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.8, 4),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  marker.position.y = 2.8;
  marker.visible = false;
  group.add(marker);
  return { group, body, marker };
}

function makeCarMesh(): THREE.Group {
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
  for (const [wx, wz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]] as const) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.35, wz);
    group.add(wheel);
  }
  return group;
}

export class Avatars {
  readonly serverOffset: number;
  private players = new Map<string, PlayerMesh>();
  private cars = new Map<string, THREE.Group>();

  constructor(private scene: THREE.Scene, private room: Room) {
    this.serverOffset = (room.state as any).serverTime - Date.now();

    (room.state.players as any).onAdd((_p: any, id: string) => {
      const mesh = makePlayerMesh();
      this.players.set(id, mesh);
      scene.add(mesh.group);
    });
    (room.state.players as any).onRemove((_p: any, id: string) => {
      const mesh = this.players.get(id);
      if (mesh) {
        scene.remove(mesh.group);
        this.players.delete(id);
      }
    });
    (room.state.cars as any).onAdd((_c: any, id: string) => {
      const mesh = makeCarMesh();
      this.cars.set(id, mesh);
      scene.add(mesh);
    });
    (room.state.cars as any).onRemove((_c: any, id: string) => {
      const mesh = this.cars.get(id);
      if (mesh) {
        scene.remove(mesh);
        this.cars.delete(id);
      }
    });
  }

  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 10);
    const nowServer = this.serverNow();

    this.players.forEach((mesh, id) => {
      const p = (this.room.state.players as any).get(id);
      if (!p) return;
      mesh.group.position.lerp(new THREE.Vector3(p.x, 0, p.z), k);
      mesh.group.rotation.y = p.rotY;
      (mesh.body.material as THREE.MeshLambertMaterial).color.set(p.role === 'cop' ? 0x2244ff : 0x888888);
      mesh.marker.visible = p.wantedUntil > nowServer;
      mesh.group.visible = p.mode !== 'car' && p.mode !== 'dead';
    });

    this.cars.forEach((mesh, id) => {
      const c = (this.room.state.cars as any).get(id);
      if (!c) return;
      mesh.position.lerp(new THREE.Vector3(c.x, 0, c.z), k);
      mesh.rotation.y = c.rotY;
    });
  }
}
```

- [ ] **Step 2: Написать `client/src/input.ts`**

```ts
import type { Room } from 'colyseus.js';

export class InputController {
  yaw = 0;
  private keys = new Set<string>();

  constructor(private room: Room, dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE') room.send('interact');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    dom.addEventListener('click', () => {
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else room.send('attack');
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) this.yaw -= e.movementX * 0.003;
    });

    setInterval(() => {
      room.send('input', {
        up: this.keys.has('KeyW'),
        down: this.keys.has('KeyS'),
        left: this.keys.has('KeyA'),
        right: this.keys.has('KeyD'),
        sprint: this.keys.has('ShiftLeft'),
        rotY: this.yaw,
      });
    }, 50);
  }
}
```

- [ ] **Step 3: Написать `client/src/camera.ts`**

```ts
import * as THREE from 'three';
import type { Room } from 'colyseus.js';

const CAM_DIST = 7;
const CAM_HEIGHT = 4;

export function updateCamera(camera: THREE.PerspectiveCamera, room: Room, yaw: number): void {
  const me = (room.state.players as any).get(room.sessionId);
  if (!me) return;
  camera.position.set(
    me.x + Math.sin(yaw) * CAM_DIST,
    CAM_HEIGHT,
    me.z + Math.cos(yaw) * CAM_DIST,
  );
  camera.lookAt(me.x, 1.5, me.z);
}
```

- [ ] **Step 4: Обновить `client/src/main.ts`**

Заменить тело `bootGame` (оставив экран входа и `start` как есть):

```ts
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect } from './net.js';
import { Avatars } from './avatars.js';
import { InputController } from './input.js';
import { updateCamera } from './camera.js';
import type { Room } from 'colyseus.js';

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const map = buildWorld(scene);
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  // const ui = new UI(room, map, avatars); // задача 15
  void map;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    avatars.update(dt);
    updateCamera(camera, room, input.yaw);
    renderer.render(scene, camera);
  });
}
```

- [ ] **Step 5: Сборка**

Run: `npm run build -w client`
Expected: успех без ошибок типов.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): аватары, интерполяция, камера 3-го лица, ввод"
```

---

### Task 15: Клиент — HUD и UI взаимодействий

**Files:**
- Create: `client/src/ui.ts`
- Modify: `client/src/main.ts` (подключить UI)

**Interfaces:**
- Consumes: `Room`, `CityMap`, `Avatars` (для `serverNow()`), константы `DOOR_DIST, CAR_ENTER_DIST, DELIVERY_PICKUP_DIST, dist2` (`@mmo/shared`).
- Produces: `class UI { constructor(room: Room, map: CityMap, avatars: Avatars); update(): void }` — HUD (HP/деньги/роль), баннеры розыска/тюрьмы/доставки, контекстная подсказка, диалог сейфа.

- [ ] **Step 1: Написать `client/src/ui.ts`**

```ts
import {
  DOOR_DIST, CAR_ENTER_DIST, DELIVERY_PICKUP_DIST, RENT_PRICE,
  dist2, type CityMap,
} from '@mmo/shared';
import type { Room } from 'colyseus.js';
import type { Avatars } from './avatars.js';

export class UI {
  private stats = document.getElementById('stats')!;
  private banner = document.getElementById('banner')!;
  private prompt = document.getElementById('prompt')!;
  private safeDialog = document.getElementById('safeDialog')!;

  constructor(private room: Room, private map: CityMap, private avatars: Avatars) {
    room.onMessage('openSafe', () => this.safeDialog.classList.remove('hidden'));
    document.getElementById('safeClose')!.addEventListener('click', () => this.safeDialog.classList.add('hidden'));
    document.getElementById('dep100')!.addEventListener('click', () => room.send('deposit', { amount: 100 }));
    document.getElementById('depAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) room.send('deposit', { amount: me.cash });
    });
    document.getElementById('wd100')!.addEventListener('click', () => room.send('withdraw', { amount: 100 }));
    document.getElementById('wdAll')!.addEventListener('click', () => {
      const me = this.me();
      if (me) room.send('withdraw', { amount: me.safe });
    });
  }

  private me(): any {
    return (this.room.state.players as any).get(this.room.sessionId);
  }

  update(): void {
    const me = this.me();
    if (!me) return;
    const nowServer = this.avatars.serverNow();

    const roleRu = me.role === 'cop' ? 'Полицейский' : 'Гражданин';
    this.stats.textContent =
      `HP: ${Math.ceil(me.hp)}  |  Наличные: ${me.cash}$  |  Сейф: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  Квартира: ${me.apt}` : ''}`;

    // Баннеры
    let bannerText = '';
    if (me.mode === 'jail') {
      bannerText = `ТЮРЬМА: ${Math.max(0, Math.ceil((me.jailUntil - nowServer) / 1000))} сек`;
    } else if (me.wantedUntil > nowServer) {
      bannerText = `В РОЗЫСКЕ: ${Math.ceil((me.wantedUntil - nowServer) / 1000)} сек`;
    } else if (me.cargo) {
      bannerText = `Груз → ${me.deliveryTarget}: ${Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000))} сек`;
    } else if (me.mode === 'dead') {
      bannerText = 'Вы погибли. Респаун...';
    }
    this.banner.textContent = bannerText;
    this.banner.classList.toggle('hidden', bannerText === '');

    this.prompt.textContent = this.computePrompt(me);
  }

  private computePrompt(me: any): string {
    if (me.mode === 'car') {
      if (!me.cargo && dist2(me.x, me.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST ** 2) {
        return 'E — взять груз';
      }
      return 'E — выйти из машины';
    }
    if (me.mode !== 'foot') return '';

    for (const [, apt] of (this.room.state.apartments as any)) {
      if (dist2(me.x, me.z, apt.doorX, apt.doorZ) < DOOR_DIST * DOOR_DIST) {
        return apt.rentedBy === me.name ? 'E — сейф' : `E — аренда ${RENT_PRICE}$`;
      }
    }
    for (const [, car] of (this.room.state.cars as any)) {
      if (!car.driverId && dist2(me.x, me.z, car.x, car.z) < CAR_ENTER_DIST * CAR_ENTER_DIST) {
        return 'E — сесть в машину';
      }
    }
    return '';
  }
}
```

Примечание: итерация `for (const [, v] of mapSchema)` работает, если MapSchema итерируема как Map; если в установленной версии `colyseus.js` иначе — заменить на `mapSchema.forEach((v) => {...})` с внешним флагом.

- [ ] **Step 2: Подключить UI в `client/src/main.ts`**

В `bootGame` заменить строки-заглушки на:

```ts
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  const ui = new UI(room, map, avatars);
```

(убрать `void map;` и закомментированную строку про UI), и в `setAnimationLoop` добавить `ui.update();` после `updateCamera(...)`. Импорт: `import { UI } from './ui.js';`

- [ ] **Step 3: Сборка**

Run: `npm run build -w client`
Expected: успех.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(client): HUD, баннеры, подсказки, диалог сейфа"
```

---

### Task 16: Нагрузочный тест — 100 ботов

**Files:**
- Create: `server/loadtest/bots.ts`

**Interfaces:**
- Consumes: запущенный сервер (`npm run dev -w server`), протокол сообщений комнаты (Task 12).
- Produces: скрипт `npm run loadtest -w server`, подключающий `BOTS` (по умолчанию 100) ботов к `SERVER_URL` (по умолчанию `ws://localhost:2567`).

- [ ] **Step 1: Написать `server/loadtest/bots.ts`**

```ts
import { Client } from 'colyseus.js';

const N = Number(process.env.BOTS ?? 100);
const url = process.env.SERVER_URL ?? 'ws://localhost:2567';

async function main(): Promise<void> {
  let connected = 0;
  for (let i = 0; i < N; i++) {
    const client = new Client(url);
    try {
      const role = i % 6 === 0 ? 'cop' : 'citizen';
      const room = await client.joinOrCreate('city', { name: `bot${i}`, role });
      connected++;
      const baseDir = Math.random() * Math.PI * 2;
      setInterval(() => {
        room.send('input', {
          up: true,
          down: false,
          left: false,
          right: false,
          sprint: Math.random() < 0.3,
          rotY: baseDir + Math.sin(Date.now() / 5000 + i) * 2,
        });
      }, 100);
      // изредка машем кулаками и жмём E
      setInterval(() => { if (Math.random() < 0.2) room.send('attack'); }, 2000);
      setInterval(() => { if (Math.random() < 0.1) room.send('interact'); }, 5000);
    } catch (e) {
      console.error(`bot${i} не подключился:`, e);
    }
    await new Promise(r => setTimeout(r, 50));
  }
  console.log(`Подключено ботов: ${connected}/${N}`);
}

void main();
```

- [ ] **Step 2: Прогнать нагрузочный тест**

Терминал 1: `npm run dev -w server`
Терминал 2: `npm run loadtest -w server` (или `BOTS=100 npm run loadtest -w server`)

Проверить:
- все 100 ботов подключились (`Подключено ботов: 100/100`);
- сервер не падает ≥ 2 минут, нет ошибок в логе;
- процесс сервера: CPU не зашкаливает на одном ядре (допустимо до ~70%), память стабильна (не растёт линейно);
- открыть браузер `http://localhost:5173` (клиент запущен `npm run dev -w client`) — мир рендерится, боты видны и движутся без слайд-шоу.

Зафиксировать результаты (CPU/память/замечания) в выводе задачи.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(server): нагрузочный тест 100 ботами"
```

---

### Task 17: Финальный ручной чек-лист и README

**Files:**
- Create: `README.md`

**Interfaces:** нет (документация и ручная проверка).

- [ ] **Step 1: Прогнать все автоматические проверки**

Run: `npm test && npm run build -w client`
Expected: все тесты зелёные, клиент собирается.

- [ ] **Step 2: Ручной чек-лист в браузере (два окна: гражданин + коп)**

Запустить `npm run dev` (сервер + клиент), открыть два окна `http://localhost:5173`:

1. Вход гражданином — спавн у больницы, HUD показывает 500$.
2. WASD двигает, Shift — бег, персонаж не проходит сквозь здания.
3. Подойти к машине — подсказка «E — сесть в машину», вход, езда (W/S газ/тормоз, A/D поворот), столкновение со зданием останавливает.
4. Подъехать к складу (оранжевый маркер) — «E — взять груз», баннер с целью и таймером, доставка в точку → +100$.
5. Ударить второго игрока кликом — у него отнимается HP; убить → он пропал, респавнился через 3 сек, у убийцы баннер «В РОЗЫСКЕ».
6. Коп видит красный маркер над розыскным; стоять рядом 3 сек → преступник в тюрьме (баннер с таймером), вышел через 2 мин у участка; коп получил бонус и зарплату (через 5 мин).
7. У двери квартиры (жёлтый маркер) — «E — аренда 100$», аренда прошла, HUD показывает квартиру; повторно у двери — открывается сейф, депозит/снятие работают.
8. Убить арендатора — он респавнится у своей двери, деньги из сейфа не потерял, наличные −50%.
9. Перезапустить сервер, зайти тем же ником — наличные, сейф и квартира на месте.
10. Закрыть вкладку и открыть заново в течение 10 сек — игрок остался тем же (реконнект).

Найденные баги фиксить отдельными коммитами `fix:`.

- [ ] **Step 3: Написать `README.md`**

```markdown
# MMO City

Браузерная 3D MMO на 100 игроков: аренда квартир, кулачный бой, машины, игроки-полицейские.

## Запуск

```bash
npm install
npm run dev        # сервер (ws://localhost:2567) + клиент (http://localhost:5173)
```

Открыть http://localhost:5173, ввести ник, выбрать роль.

## Управление

- WASD — движение, Shift — бег, мышь — камера
- ЛКМ (после захвата указателя) — удар
- E — сесть/выйти из машины, взять груз, аренда, сейф

## Команды

- `npm test` — юнит- и интеграционные тесты
- `npm run build -w client` — сборка клиента
- `npm run loadtest -w server` — 100 ботов против локального сервера

## Структура

- `shared/` — константы, карта города, физика (общая для сервера и клиента)
- `server/` — Colyseus-комната, игровые системы, SQLite
- `client/` — Three.js-рендер, ввод, HUD
```

- [ ] **Step 4: Финальный коммит**

```bash
git add -A
git commit -m "docs: README с запуском и управлением"
```

---

## Известные ограничения MVP (не баги)

- Два игрока с одинаковым ником делят один аккаунт (одна запись в БД).
- Нет клиентского предсказания движения: на высоком пинге управление отстаёт. На localhost незаметно.
- Машины и игроки не сталкиваются между собой.
- Серверное время на клиенте считается через offset при подключении; при сильном скачке часов возможны артефакты баннеров.
