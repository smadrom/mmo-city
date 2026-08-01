# Программа «играбельность+» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Воплотить спек `docs/superpowers/specs/2026-08-01-gameplay-ux-program-design.md`: баланс (M1), UX (M2), метагейм (M3), звуки (M5), локализация RU/EN (M4), реконнект (M6), адаптив+тач (M7).

**Architecture:** Правки ложатся на существующие модули: константы в `shared/src/config.ts`, логика в `server/src/systems/*`, сообщения в `server/src/rooms/CityRoom.ts`, клиент — `client/src/*` без фреймворка. Новые файлы: `client/src/feed.ts`, `client/src/i18n/{index,ru,en}.ts`, `client/src/touch.ts`. Новых зависимостей нет.

**Tech Stack:** Colyseus 0.16 (`client.reconnect(room.reconnectionToken)` — проверено по `node_modules/colyseus.js/lib/Client.d.ts:42`, `Room.d.ts:15`), better-sqlite3, Vitest + @colyseus/testing, Vite/Three.js.

## Global Constraints

- Node 20 (`.nvmrc`), ESM (`"type": "module"`), TS strict; серверные импорты с суффиксом `.js`.
- Новых зависимостей НЕ добавляем ни в один package.json.
- Комментарии в коде — по-русски, коротко, про «почему» (стиль проекта).
- Тесты: `cd server && npx vitest run test/<file>` точечно; `npm test` из корня — полный сьют; `npm run typecheck` из корня перед каждым коммитом.
- Каждая тестовая комната = своя in-memory БД (`GAME_DB=':memory:'`), тесты независимы.
- Коммиты: conventional-commits на русском (`feat(server): …`, `fix(client): …`). Без AI-атрибуции.
- Порядок задач строгий: 1→19 (каждая следующая опирается на предыдущие).

---

## M1. Баланс

### Task 1: Награда доставки от дистанции

**Files:**
- Modify: `shared/src/config.ts:51` (замена `DELIVERY_REWARD`)
- Modify: `shared/src/map.ts` (функция `deliveryReward`)
- Modify: `server/src/systems/economy.ts:1-5,49-65`
- Modify: `server/test/economy.test.ts:4,48-57`
- Modify: `client/src/ui.ts:162-165` (баннер с наградой), `client/src/phone.ts:126-131` (jobInfo с наградой)

**Interfaces:**
- Produces: `DELIVERY_REWARD_BASE = 60`, `DELIVERY_REWARD_PER_M = 0.4` (shared config); `deliveryReward(map: CityMap, targetId: string): number` (shared map). `DELIVERY_REWARD` больше НЕ существует.

- [ ] **Step 1: Падающий тест**

В `server/test/economy.test.ts`:
- строку 4 заменить на:
```ts
import { deliveryReward, DELIVERY_TIME_MS, createCityMap, START_CASH, TRANSFER_MAX } from '@mmo/shared';
```
- тест `'доставка в точку: награда, груз снят'` (строки 48-57) заменить на:
```ts
  it('доставка в точку: награда от дистанции, груз снят', () => {
    const { state, p } = setup();
    tryStartDelivery(state, 's1', map, 1000);
    const target = map.deliveryTargets.find(t => t.id === p.deliveryTarget)!;
    const expected = deliveryReward(map, target.id);
    p.x = target.x; p.z = target.z;
    tickDelivery(state, map, 2000);
    expect(p.cargo).toBe(false);
    expect(p.cash).toBe(expected);
    expect(p.deliveryTarget).toBe('');
  });

  it('дальняя точка платит больше ближней', () => {
    expect(deliveryReward(map, 'port')).toBeGreaterThan(deliveryReward(map, 'shop'));
    expect(deliveryReward(map, 'shop')).toBeGreaterThanOrEqual(60); // база
    expect(deliveryReward(map, 'ghost')).toBe(60); // неизвестная точка — база
  });
```

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/economy.test.ts`
Expected: FAIL — `DELIVERY_REWARD`/`deliveryReward` не экспортируются.

- [ ] **Step 3: Реализация**

`shared/src/config.ts:51` — строку `export const DELIVERY_REWARD = 100;` заменить на:
```ts
export const DELIVERY_REWARD_BASE = 60;   // минимум за заказ
export const DELIVERY_REWARD_PER_M = 0.4; // + за метр от склада до точки
```

`shared/src/map.ts` — импорт в строке 1 заменить на `import { MAP_HALF, DELIVERY_REWARD_BASE, DELIVERY_REWARD_PER_M } from './config.js';` и в конец файла добавить:
```ts
// награда растёт с дистанцией склад→точка, иначе выгодно ре-роллить заказ до ближней
export function deliveryReward(map: CityMap, targetId: string): number {
  const t = map.deliveryTargets.find(t => t.id === targetId);
  if (!t) return DELIVERY_REWARD_BASE;
  return Math.round(DELIVERY_REWARD_BASE + DELIVERY_REWARD_PER_M * Math.hypot(t.x - map.warehouse.x, t.z - map.warehouse.z));
}
```

`server/src/systems/economy.ts` — в импорте (строки 1-5) `DELIVERY_REWARD` заменить на `deliveryReward`. В `tickDelivery` блок сдачи (строки 59-63) заменить на:
```ts
    if (t && dist2(p.x, p.z, t.x, t.z) < DELIVERY_DROP_DIST * DELIVERY_DROP_DIST) {
      const reward = deliveryReward(map, p.deliveryTarget); // до очистки target
      p.cargo = false;
      p.deliveryTarget = '';
      p.cash += reward;
    }
```

- [ ] **Step 4: Клиент показывает награду**

`client/src/ui.ts` — импорт из `@mmo/shared` дополнить `deliveryReward`; в `update()` строку баннера груза (162-164) заменить на:
```ts
    if (me.cargo) {
      const target = TARGET_LABELS[me.deliveryTarget] ?? me.deliveryTarget;
      lines.push(`Груз → ${target}: ${Math.max(0, Math.ceil((me.deliveryDeadline - nowServer) / 1000))} сек (+${deliveryReward(this.map, me.deliveryTarget)}$)`);
    }
```

`client/src/phone.ts` — в `update()` ветку `me.cargo` (126-131) заменить на:
```ts
    if (me.cargo) {
      const target = TARGET_LABELS[me.deliveryTarget] ?? me.deliveryTarget;
      const left = Math.max(0, Math.ceil((me.deliveryDeadline - this.serverNow()) / 1000));
      const reward = deliveryReward(this.map, me.deliveryTarget);
      info.textContent = `Заказ: груз → ${target}. Осталось ${left} сек. Награда ${reward}$. Сдача — доехать до точки на машине.`;
      btn.textContent = 'Отказаться от заказа';
    }
```
Для этого `Phone` должен знать карту: в конструктор добавить параметр `private map: CityMap` (третьим, перед `input`), импортировать `deliveryReward, type CityMap` из `@mmo/shared`. В `client/src/main.ts:75` вызов заменить на `new Phone(room, map, input, (t) => ui.showToast(t), () => avatars.serverNow());`.

- [ ] **Step 5: Прогнать — зелёное**

Run: `cd server && npx vitest run test/economy.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 6: Commit**

```bash
git add shared/src/config.ts shared/src/map.ts server/src/systems/economy.ts server/test/economy.test.ts client/src/ui.ts client/src/phone.ts client/src/main.ts
git commit -m "feat(shared): награда доставки от дистанции (60 + 0.4/м), показ в баннере и телефоне"
```

---

### Task 2: Кулдаун 30 сек на заказ после отказа/просрочки

**Files:**
- Modify: `shared/src/config.ts` (константа)
- Modify: `server/src/runtime.ts` (поле `nextJobAt`)
- Modify: `server/src/systems/economy.ts` (сигнатуры try*Job/tickDelivery)
- Modify: `server/src/rooms/CityRoom.ts:190-197,383-393,424`
- Modify: `client/src/phone.ts:89-91` (тексты jobResult)
- Test: `server/test/economy.test.ts` (обновить вызовы + новые кейсы)

**Interfaces:**
- Consumes: `deliveryReward` (Task 1).
- Produces: `JOB_RETRY_COOLDOWN_MS = 30_000`; `Runtime.nextJobAt: number`; `tryStartDelivery(state, playerId, map, now, rt): boolean`; `tryTakeJob(state, playerId, map, now, rt): 'ok' | 'need_car' | 'job_cooldown'`; `tryDropJob(state, playerId, rt, now): boolean`; `tickDelivery(state, map, now, runtimes): void`.

- [ ] **Step 1: Падающие тесты**

В `server/test/economy.test.ts`:
- импорты: добавить `makeRuntime` из `../src/runtime.js` и `JOB_RETRY_COOLDOWN_MS` в импорт из `@mmo/shared`.
- в `setup()` (доставка) добавить `const rt = makeRuntime(0); const runtimes = new Map([['s1', rt]]);` и вернуть их: `return { state, p, car, rt, runtimes };`.
- все вызовы обновить: `tryStartDelivery(state, 's1', map, 1000, rt)`, `tickDelivery(state, map, 2000, runtimes)`, `tryTakeJob(state, 's1', map, 10_000, rt)` (возврат теперь строка: `toBe('ok')` / `toBe('need_car')`), `tryDropJob(state, 's1', rt, 2000)`.
- в `setupJob()` добавить `const rt = makeRuntime(0); const runtimes = new Map([['s1', rt]]);` и вернуть.
- тест `'tryTakeJob: пешком или с грузом — отказ'`: ожидания `.toBe('need_car')` вместо `toBe(false)`; с грузом — тоже `'need_car'`.
- тест `'tryDropJob: снимает заказ; без заказа — false'` переписать:
```ts
  it('tryDropJob: снимает заказ и вешает кулдаун; без заказа — false', () => {
    const { state, p, map, rt } = setupJob();
    expect(tryDropJob(state, 's1', rt, 2000)).toBe(false);
    expect(tryTakeJob(state, 's1', map, 1000, rt)).toBe('ok');
    expect(tryDropJob(state, 's1', rt, 2000)).toBe(true);
    expect(p.cargo).toBe(false);
    expect(rt.nextJobAt).toBe(2000 + JOB_RETRY_COOLDOWN_MS);
    expect(tryTakeJob(state, 's1', map, 2001, rt)).toBe('job_cooldown'); // кулдаун после отказа
    expect(tryTakeJob(state, 's1', map, 2000 + JOB_RETRY_COOLDOWN_MS, rt)).toBe('ok');
  });
```
- добавить новые тесты:
```ts
  it('кулдаун не ставится при успешной сдаче', () => {
    const { state, p, map, rt, runtimes } = setupJob();
    tryTakeJob(state, 's1', map, 1000, rt);
    const target = map.deliveryTargets.find(t => t.id === p.deliveryTarget)!;
    p.x = target.x; p.z = target.z;
    tickDelivery(state, map, 2000, runtimes);
    expect(p.cargo).toBe(false);
    expect(rt.nextJobAt).toBe(0);
  });

  it('просрочка заказа вешает кулдаун', () => {
    const { state, p, map, rt, runtimes } = setupJob();
    tryTakeJob(state, 's1', map, 1000, rt);
    tickDelivery(state, map, 1000 + DELIVERY_TIME_MS + 1, runtimes);
    expect(p.cargo).toBe(false);
    expect(rt.nextJobAt).toBe(1000 + DELIVERY_TIME_MS + 1 + JOB_RETRY_COOLDOWN_MS);
  });

  it('складской tryStartDelivery молча уважает кулдаун', () => {
    const { state, p, rt } = setup();
    rt.nextJobAt = 5000;
    expect(tryStartDelivery(state, 's1', map, 1000, rt)).toBe(false);
    expect(tryStartDelivery(state, 's1', map, 5000, rt)).toBe(true);
  });
```
(В `setup()` вернуть и `rt` с `runtimes`; тесты таймаута/пешком обновить на новые сигнатуры.)

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/economy.test.ts`
Expected: FAIL — сигнатуры/поля не существуют.

- [ ] **Step 3: Реализация**

`shared/src/config.ts` после строки `DELIVERY_DROP_DIST`:
```ts
export const JOB_RETRY_COOLDOWN_MS = 30_000; // пауза на новый заказ после отказа/просрочки
```

`server/src/runtime.ts`: в интерфейс после `frozen: boolean;` добавить `nextJobAt: number; // кулдаун заказа доставки (отказ/просрочка)`; в `makeRuntime` после `frozen: false,` добавить `nextJobAt: 0,`.

`server/src/systems/economy.ts`:
- импорт: добавить `JOB_RETRY_COOLDOWN_MS` в `@mmo/shared`; добавить `import type { Runtime } from '../runtime.js';`.
- `tryStartDelivery` — сигнатура и гард:
```ts
export function tryStartDelivery(
  state: GameState,
  playerId: string,
  map: CityMap,
  now: number,
  rt: Runtime,
): boolean {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return false;
  if (now < rt.nextJobAt) return false; // кулдаун после отказа/просрочки
  if (dist2(p.x, p.z, map.warehouse.x, map.warehouse.z) > DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) return false;
  assignDelivery(p, map, now);
  return true;
}
```
- `tryTakeJob`:
```ts
export type TakeJobResult = 'ok' | 'need_car' | 'job_cooldown';

// телефон: тот же заказ, но без поездки на склад (машина всё равно обязательна)
export function tryTakeJob(state: GameState, playerId: string, map: CityMap, now: number, rt: Runtime): TakeJobResult {
  const p = state.players.get(playerId);
  if (!p || !canTakeDelivery(p)) return 'need_car';
  if (now < rt.nextJobAt) return 'job_cooldown';
  assignDelivery(p, map, now);
  return 'ok';
}
```
- `tryDropJob`:
```ts
export function tryDropJob(state: GameState, playerId: string, rt: Runtime, now: number): boolean {
  const p = state.players.get(playerId);
  if (!p || !p.cargo) return false;
  p.cargo = false;
  p.deliveryTarget = '';
  rt.nextJobAt = now + JOB_RETRY_COOLDOWN_MS; // ре-ролл заказов — с паузой
  return true;
}
```
- `tickDelivery` — сигнатура `(state: GameState, map: CityMap, now: number, runtimes: Map<string, Runtime>): void`; в `forEach` добавить `id`: `state.players.forEach((p, id) => {`; ветку просрочки заменить на:
```ts
    if (now > p.deliveryDeadline) {
      p.cargo = false;
      p.deliveryTarget = '';
      const rt = runtimes.get(id);
      if (rt) rt.nextJobAt = now + JOB_RETRY_COOLDOWN_MS; // просрочил — пауза на новый заказ
      return;
    }
```

`server/src/rooms/CityRoom.ts`:
- обработчики (190-197) заменить на:
```ts
    this.onMessage('jobTake', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      const res = tryTakeJob(this.state, client.sessionId, this.map, Date.now(), rt);
      client.send('jobResult', { ok: res === 'ok', error: res === 'ok' ? undefined : res });
    });
    this.onMessage('jobDrop', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      const ok = tryDropJob(this.state, client.sessionId, rt, Date.now());
      client.send('jobResult', { ok, error: ok ? undefined : 'no_job' });
    });
```
- в `handleInteract` (387-389) складскую ветку заменить на:
```ts
      if (!p.cargo && dist2(p.x, p.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) {
        const rt = this.runtimes.get(client.sessionId);
        if (rt) tryStartDelivery(this.state, client.sessionId, this.map, Date.now(), rt);
        return;
      }
```
- в `tick` (424) заменить на `tickDelivery(this.state, this.map, now, this.runtimes);`.

`client/src/phone.ts` — обработчик `jobResult` (89-91) заменить на:
```ts
    room.onMessage('jobResult', (m: any) => {
      if (m.ok) return;
      const texts: Record<string, string> = {
        need_car: 'Нужно быть в машине', no_job: 'Нет активного заказа',
        job_cooldown: 'Новый заказ будет через 30 секунд',
      };
      this.toast(texts[m.error] ?? 'Ошибка заказа');
    });
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `cd server && npx vitest run test/economy.test.ts test/phone.integration.test.ts test/room.integration.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS (интеграционные тесты заказов проходят — серверные обработчики обновлены вместе с системой), typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add shared/src/config.ts server/src/runtime.ts server/src/systems/economy.ts server/src/rooms/CityRoom.ts client/src/phone.ts server/test/economy.test.ts
git commit -m "feat(server): кулдаун 30с на заказ после отказа/просрочки (анти-реролл)"
```

---

### Task 3: Бафф копа и пистолета

**Files:**
- Modify: `shared/src/config.ts:22,43`

**Interfaces:**
- Produces: `ARREST_BONUS = 150`, `WEAPONS.pistol.damage = 25`.

- [ ] **Step 1: Изменить константы**

`shared/src/config.ts`: `price: 600,  damage: 15,` → `price: 600,  damage: 25,`; `export const ARREST_BONUS = 50;` → `export const ARREST_BONUS = 150;` (с комментарием `// арест должен быть выгоден — иначе коп худшая роль`).

- [ ] **Step 2: Прогнать**

Run: `npm test && npm run typecheck` (из корня)
Expected: PASS — тесты ссылаются на константы (`police.test.ts:37` импортирует `ARREST_BONUS`, урон читается из `WEAPONS`), хардкода нет. Если какой-то тест упал на захардкоженном числе — обновить ожидание на константу.

- [ ] **Step 3: Commit**

```bash
git add shared/src/config.ts
git commit -m "feat(shared): баланс — арест 150$, урон пистолета 25 (между битой и винтовкой)"
```

---

### Task 4: Дроп денег с зомби и оружия с игрока

**Files:**
- Modify: `server/src/systems/pickups.ts` (spawnWeaponDrop + удаление дропа при подборе)
- Modify: `server/src/systems/combat.ts:117-127` (дропы в killPlayer)
- Test: `server/test/combat.test.ts` (новые кейсы), `server/test/pickups.test.ts` (кейс: дроп не респаунится)

**Interfaces:**
- Produces: `spawnWeaponDrop(state: GameState, x: number, z: number, kind: string, id: string): void` (pickups.ts). Правило: пикап без runtime-записи после подбора удаляется из state (не респаунится).

- [ ] **Step 1: Падающие тесты**

В `server/test/combat.test.ts` добавить describe (стиль существующего файла — `GameState`, `Player`, `makeRuntime`):
```ts
describe('дропы при смерти', () => {
  function setupKill() {
    const state = new GameState();
    const runtimes = new Map();
    const killer = new Player();
    killer.name = 'killer';
    state.players.set('k', killer);
    runtimes.set('k', makeRuntime(0));
    const victim = new Player();
    victim.name = 'victim';
    victim.hp = 10;
    state.players.set('v', victim);
    runtimes.set('v', makeRuntime(0));
    return { state, runtimes, killer, victim };
  }

  it('с игрока падает его оружие пикапом', () => {
    const { state, runtimes, victim } = setupKill();
    victim.weapon = 'rifle';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'rifle');
    expect(drops).toHaveLength(1);
    expect(victim.weapon).toBe('');
  });

  it('с зомби падает 10-29$ (PvE-фарм), убийце-зомби — ничего', () => {
    const { state, runtimes, victim } = setupKill();
    victim.role = 'zombie';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    const drops = [...state.pickups.values()].filter(pk => pk.kind === 'cash');
    expect(drops).toHaveLength(1);
    expect(drops[0].amount).toBeGreaterThanOrEqual(10);
    expect(drops[0].amount).toBeLessThanOrEqual(29);
  });

  it('без оружия — без оружейного дропа', () => {
    const { state, runtimes, victim } = setupKill();
    victim.weapon = '';
    victim.cash = 0;
    killPlayer(state, runtimes, 'k', 'v', 1000);
    expect([...state.pickups.values()].filter(pk => pk.kind !== 'cash')).toHaveLength(0);
  });
});
```
(Импорты `makeRuntime`, `killPlayer` — по существующим в файле; если `killPlayer` ещё не импортирован — добавить.)

В `server/test/pickups.test.ts` добавить:
```ts
  it('дроп (пикап без runtime) после подбора удаляется, а не респаунится', () => {
    const state = new GameState();
    const p = new Player();
    p.name = 'looter';
    p.mode = 'foot';
    state.players.set('s1', p);
    spawnWeaponDrop(state, p.x, p.z, 'bat', 'wpn-test');
    const runtimes = new Map(); // пусто: дроп runtime-записи не имеет
    tickPickups(state, runtimes, 1000);
    expect(p.weapon).toBe('bat');
    expect(state.pickups.has('wpn-test')).toBe(false);
    tickPickups(state, runtimes, 1000 + PICKUP_RESPAWN_MS + 1);
    expect(state.pickups.has('wpn-test')).toBe(false);
  });
```
(Импорты `spawnWeaponDrop`, `PICKUP_RESPAWN_MS`, `tickPickups` — дополнить существующие.)

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/combat.test.ts test/pickups.test.ts`
Expected: FAIL — `spawnWeaponDrop` не существует, дропы не появляются.

- [ ] **Step 3: Реализация**

`server/src/systems/pickups.ts` — после `spawnCashDrop` добавить:
```ts
// дроп оружия с трупа: как деньги — без runtime, после подбора удаляется (не респаунится)
export function spawnWeaponDrop(state: GameState, x: number, z: number, kind: string, id: string): void {
  const pk = new Pickup();
  pk.id = id;
  pk.kind = kind;
  pk.x = x;
  pk.z = z;
  state.pickups.set(id, pk);
}
```
В `tickPickups` хвост ветки weapon/ammo (строки 58-68) заменить на:
```ts
      if (pk.kind === 'ammo') {
        p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
      } else {
        p.weapon = pk.kind; // замена без возврата, как покупка
        if (WEAPONS[pk.kind as WeaponKind]?.ranged) {
          p.ammo = Math.min(AMMO_MAX, p.ammo + AMMO_PACK_SIZE);
        }
      }
      const rt = runtimes.get(id);
      if (!rt) {
        state.pickups.delete(id); // дроп с трупа — подобрали и нет, респаун только у регулярных
        return;
      }
      pk.active = false;
      rt.respawnAt = now + PICKUP_RESPAWN_MS;
```

`server/src/systems/combat.ts`:
- импорт из `./pickups.js`: `spawnCashDrop, spawnWeaponDrop`.
- в `killPlayer` после строки 120 (`if (drop > 0) spawnCashDrop(...)`) добавить:
```ts
  if (victim.role !== 'zombie' && victim.weapon) {
    // трофей: оружие жертвы падает пикапом — охота за стволами, а не молчаливое сжигание
    spawnWeaponDrop(state, victim.x, victim.z, victim.weapon, `wpn-${victimId}-${now}`);
  }
  if (victim.role === 'zombie' && killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    if (killer && killer.role !== 'zombie') {
      // PvE-фарм кладбища: 10-29$ с зомби, иначе зомби — чистый негатив без награды
      spawnCashDrop(state, victim.x, victim.z, 10 + Math.floor(Math.random() * 20), `zcash-${victimId}-${now}`);
    }
  }
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `cd server && npx vitest run test/combat.test.ts test/pickups.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add server/src/systems/pickups.ts server/src/systems/combat.ts server/test/combat.test.ts server/test/pickups.test.ts
git commit -m "feat(server): дроп оружия с трупа игрока, денежный дроп 10-29$ с зомби"
```

---

## M2. UX

### Task 5: HP-бар и крупный счётчик патронов в HUD

**Files:**
- Modify: `client/index.html:20-23` (блоки hp/ammo)
- Modify: `client/src/style.css` (стили)
- Modify: `client/src/ui.ts:146-152` (update)

**Interfaces:**
- Produces: DOM `#hpbar > #hpfill`, `#hptext`, `#ammoBig`. Сервер не меняется. Тестов нет (клиент без тест-инфраструктуры) — проверка typecheck + ручная.

- [ ] **Step 1: HTML**

`client/index.html` — в `#hud` вместо `<div id="stats"></div>` (строка 21) вставить:
```html
    <div id="hpbar"><div id="hpfill"></div><span id="hptext"></span></div>
    <div id="ammoBig" class="hidden"></div>
    <div id="stats"></div>
```

- [ ] **Step 2: CSS**

`client/src/style.css` — после правила `#stats` добавить:
```css
#hpbar {
  position: absolute; top: 10px; left: 10px; width: 220px; height: 16px;
  background: rgba(0,0,0,.55); border-radius: 8px; overflow: hidden;
}
#hpfill { height: 100%; width: 100%; background: #33cc33; transition: width .15s; }
#hptext {
  position: absolute; inset: 0; text-align: center; color: #fff;
  font-size: 12px; line-height: 16px; font-weight: bold; text-shadow: 0 0 3px #000;
}
#ammoBig {
  position: absolute; top: 30px; left: 10px; color: #fff; font-size: 22px;
  font-weight: bold; text-shadow: 0 0 4px #000;
}
```
Правило `#stats` скорректировать: `top: 10px` → `top: 56px` (сместить под бар/патроны).

- [ ] **Step 3: ui.ts**

`client/src/ui.ts`:
- в поля класса добавить:
```ts
  private hpfill = document.getElementById('hpfill')!;
  private hptext = document.getElementById('hptext')!;
  private ammoBig = document.getElementById('ammoBig')!;
```
- в `update()` блок stats (строки 146-152) заменить на:
```ts
    const k = Math.max(0, Math.min(1, me.hp / MAX_HP));
    this.hpfill.style.width = `${k * 100}%`;
    (this.hpfill.style as any).background = k > 0.5 ? '#33cc33' : k > 0.25 ? '#ddaa22' : '#cc2222';
    this.hptext.textContent = `${Math.ceil(me.hp)}`;
    const roleRu = me.role === 'cop' ? 'Полицейский' : 'Гражданин';
    const w = me.weapon && Object.hasOwn(WEAPONS, me.weapon) ? WEAPONS[me.weapon as WeaponKind] : null;
    this.ammoBig.classList.toggle('hidden', !w?.ranged);
    if (w?.ranged) this.ammoBig.textContent = `▸ ${me.ammo}`;
    this.stats.textContent =
      `Наличные: ${me.cash}$  |  Сейф: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  Квартира: ${me.apt}` : ''}\n` +
      `Оружие: ${w ? w.name : 'Кулаки'}`;
```
- импорт из `@mmo/shared` дополнить `MAX_HP`.

- [ ] **Step 4: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто. Ручная проверка откладывается на Task 19 (smoke).

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/style.css client/src/ui.ts
git commit -m "feat(client): HP-бар и крупный счётчик патронов в HUD"
```

---

### Task 6: Блок ввода в диалогах + pixelRatio + resize полной карты

**Files:**
- Modify: `client/src/ui.ts` (setBlocked на диалогах, закрытие по Esc)
- Modify: `client/src/main.ts:61,82-86` (pixelRatio)
- Modify: `client/src/fullmap.ts:41` (resize listener)

**Interfaces:**
- Consumes: `InputController.setBlocked` (существует, `input.ts:17`).
- Produces: `UI.closeDialogs(): void` (private) — единая точка закрытия диалогов со снятием блока.

- [ ] **Step 1: ui.ts — блок ввода**

`client/src/ui.ts`:
- обработчики `openSafe`/`openShop` (26-29, 45-48) дополнить блоком: в оба после `document.exitPointerLock();` вставить `this.input.setBlocked(true);` (поле `input` уже есть в конструкторе, строка 24).
- добавить private-метод:
```ts
  private closeDialogs(): void {
    const wasOpen = !this.safeDialog.classList.contains('hidden') || !this.shopDialog.classList.contains('hidden');
    this.safeDialog.classList.add('hidden');
    this.shopDialog.classList.add('hidden');
    if (wasOpen) this.input.setBlocked(false); // диалог закрыт — управление вернуть
  }
```
- обработчики кнопок `safeClose`/`shopClose` (30, 71) заменить на `() => this.closeDialogs()`.
- в конструктор добавить закрытие по Esc (рядом с chatInput keydown, после строки 99):
```ts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.closeDialogs();
    });
```
- в `update()` авто-закрытия (170-177) заменить вызовы `this.safeDialog.classList.add('hidden')` / `this.shopDialog.classList.add('hidden')` на `this.closeDialogs()` (два места: отошёл от двери; отошёл от магазина/сел в машину/умер).

- [ ] **Step 2: main.ts — pixelRatio**

`client/src/main.ts` после строки 61 (`new THREE.WebGLRenderer`) вставить:
```ts
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // чёткость на Retina; кап 2 — перф
```

- [ ] **Step 3: fullmap.ts — resize**

`client/src/fullmap.ts` в конструктор после `wheel`-слушателя (строка 29) добавить:
```ts
    // ресайз окна с открытой картой: пересчитать canvas, иначе пропорции едут
    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.renderNow();
    });
```

- [ ] **Step 4: Прогнать**

Run: `npm run typecheck && npm test` (из корня)
Expected: чисто и зелёно (сервер не тронут).

- [ ] **Step 5: Commit**

```bash
git add client/src/ui.ts client/src/main.ts client/src/fullmap.ts
git commit -m "fix(client): блок ввода в диалогах магазина/сейфа, pixelRatio, resize полной карты"
```

---

### Task 7: Экран смерти

**Files:**
- Modify: `client/index.html:80` (оверлей)
- Modify: `client/src/style.css` (стиль)
- Modify: `client/src/ui.ts` (логика + убрать строку из баннера)

**Interfaces:**
- Produces: DOM `#deathOverlay`, `#deathTimer`. Поле `UI.diedAt: number` (performance.now момента смерти).

- [ ] **Step 1: HTML+CSS**

`client/index.html` — после `<div id="vignette" ...>` (строка 80) добавить:
```html
    <div id="deathOverlay" class="hidden">
      <div id="deathTitle">Вы погибли</div>
      <div id="deathTimer"></div>
    </div>
```

`client/src/style.css` в конец:
```css
#deathOverlay {
  position: fixed; inset: 0; z-index: 7; pointer-events: none;
  background: rgba(60, 0, 0, .45); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
}
#deathTitle { color: #ff6666; font-size: 42px; font-weight: bold; text-shadow: 0 0 12px #000; }
#deathTimer { color: #fff; font-size: 20px; text-shadow: 0 0 6px #000; }
```

- [ ] **Step 2: ui.ts**

`client/src/ui.ts`:
- поля:
```ts
  private deathOverlay = document.getElementById('deathOverlay')!;
  private deathTimer = document.getElementById('deathTimer')!;
  private diedAt = 0; // performance.now() входа в mode='dead' — отсчёт респавна
```
- в `update()`: строку баннера `if (me.mode === 'dead') lines.push('Вы погибли. Респаун...');` (166) удалить. После блока баннеров (168) добавить:
```ts
    // экран смерти с отсчётом до респавна (зомби-режимов у игрока нет — всегда RESPAWN_DELAY_MS)
    if (me.mode === 'dead') {
      if (!this.diedAt) this.diedAt = performance.now();
      const left = Math.max(0, Math.ceil((RESPAWN_DELAY_MS - (performance.now() - this.diedAt)) / 1000));
      this.deathTimer.textContent = `Респаун через ${left}`;
      this.deathOverlay.classList.remove('hidden');
    } else {
      this.diedAt = 0;
      this.deathOverlay.classList.add('hidden');
    }
```
- импорт из `@mmo/shared` дополнить `RESPAWN_DELAY_MS`.

- [ ] **Step 3: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто.

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/src/style.css client/src/ui.ts
git commit -m "feat(client): полноэкранный экран смерти с отсчётом респавна"
```

---

## M3. Метагейм

### Task 8: Kill-события, bounty и feed на сервере

**Files:**
- Modify: `shared/src/config.ts` (BOUNTY_REWARD)
- Modify: `server/src/systems/combat.ts` (KillEvent, bounty, out-параметр events)
- Modify: `server/src/systems/vehicles.ts:13-22,90` (events в tickVehicles)
- Modify: `server/src/systems/zombies.ts:23-29,75` (events в tickZombies)
- Modify: `server/src/systems/police.ts:9-15,73-75` (возврат арестов)
- Modify: `server/src/rooms/CityRoom.ts` (дренаж событий → broadcast 'feed')
- Test: `server/test/combat.test.ts` (bounty), `server/test/police.test.ts` (возврат арестов)

**Interfaces:**
- Produces: `BOUNTY_REWARD = 25`; `interface KillEvent { killerId: string; victimId: string; bounty: boolean }`; `killPlayer(..., events?: KillEvent[])`, `handleAttack(..., events?: KillEvent[])`, `tickVehicles(..., safeZones?, events?): Hit[]`, `tickZombies(..., events?): AttackResult[]`, `tickPolice(...): { cop: string; crim: string }[]`; broadcast-сообщение `feed { kind: 'kill'|'bounty'|'arrest', a: string, b: string }` (ники).

- [ ] **Step 1: Падающие тесты**

В `server/test/combat.test.ts` (в describe про killPlayer или новый):
```ts
describe('bounty', () => {
  function setupWanted() {
    const state = new GameState();
    const runtimes = new Map();
    const hunter = new Player();
    hunter.name = 'hunter';
    hunter.cash = 100;
    state.players.set('h', hunter);
    runtimes.set('h', makeRuntime(0));
    const crim = new Player();
    crim.name = 'crim';
    crim.hp = 10;
    crim.cash = 0;
    state.players.set('c', crim);
    runtimes.set('c', makeRuntime(0));
    return { state, runtimes, hunter, crim };
  }

  it('убийство розыскного: +25$ и без розыска охотнику, событие bounty', () => {
    const { state, runtimes, hunter, crim } = setupWanted();
    crim.wantedUntil = 5000;
    const events: KillEvent[] = [];
    killPlayer(state, runtimes, 'h', 'c', 1000, events);
    expect(hunter.cash).toBe(125); // 100 + BOUNTY_REWARD
    expect(hunter.wantedUntil).toBe(0);
    expect(events).toEqual([{ killerId: 'h', victimId: 'c', bounty: true }]);
  });

  it('убийство чистого: розыск охотнику, событие kill', () => {
    const { state, runtimes, hunter } = setupWanted();
    const events: KillEvent[] = [];
    killPlayer(state, runtimes, 'h', 'c', 1000, events);
    expect(hunter.wantedUntil).toBe(1000 + WANTED_DURATION_MS);
    expect(events[0].bounty).toBe(false);
  });
});
```
(Импорты: `killPlayer`, `KillEvent`, `WANTED_DURATION_MS` — дополнить существующие.)

В `server/test/police.test.ts` в существующий тест ареста добавить проверку возврата: присвоить результат `const arrests = tickPolice(...)` и `expect(arrests).toEqual([{ cop: 'copnick', crim: 'crimnick' }])` (имена — как заданы в setup теста; подставить фактические). Если существующий тест не задаёт имена — задать `cop.name = 'cop1'; crim.name = 'crim1';` в setup и ожидать `[{ cop: 'cop1', crim: 'crim1' }]`.

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/combat.test.ts test/police.test.ts`
Expected: FAIL — `KillEvent`, 4-й аргумент events, возврат tickPolice.

- [ ] **Step 3: Реализация**

`shared/src/config.ts` после `ARREST_BONUS`:
```ts
export const BOUNTY_REWARD = 25; // за убийство розыскного; праведное — розыск не даём
```

`server/src/systems/combat.ts`:
- импорт из `@mmo/shared` дополнить `BOUNTY_REWARD`.
- перед `killPlayer` добавить:
```ts
export interface KillEvent { killerId: string; victimId: string; bounty: boolean }
```
- сигнатуру `killPlayer(state, runtimes, killerId, victimId, now)` заменить на `killPlayer(state, runtimes, killerId, victimId, now, events?: KillEvent[])`.
- блок убийцы (строки 130-135) заменить на:
```ts
  if (killerId && killerId !== victimId) {
    const killer = state.players.get(killerId);
    const krt = runtimes.get(killerId);
    const bounty = !!killer && killer.role !== 'zombie' && victim.role !== 'zombie' && victim.wantedUntil > now;
    if (killer && killer.role !== 'zombie' && victim.role !== 'zombie' && !bounty) {
      killer.wantedUntil = now + WANTED_DURATION_MS; // зомби розыск не получают и за зомби розыска нет
    }
    if (bounty && killer) killer.cash += BOUNTY_REWARD; // праведное убийство: награда вместо розыска
    if (krt) krt.kills++;
    events?.push({ killerId, victimId, bounty });
  }
```
- `handleAttack`: сигнатуру дополнить последним параметром `events?: KillEvent[]`; оба вызова `killPlayer(state, runtimes, attackerId, bestId, now)` (строки 79, 94) → `killPlayer(state, runtimes, attackerId, bestId, now, events)`.

`server/src/systems/vehicles.ts`: сигнатуру `tickVehicles(..., safeZones: AABB[] = [])` дополнить `, events?: KillEvent[]` (импорт типа из `./combat.js`: `killPlayer, type Hit, type KillEvent`); строку 90 → `if (v.hp <= 0) killPlayer(state, runtimes, car.driverId, vid, now, events);`.

`server/src/systems/zombies.ts`: сигнатуру `tickZombies(...)` дополнить `, events?: KillEvent[]` (импорт: `import { handleAttack, type AttackResult, type KillEvent } from './combat.js';`); строку 75 → `const res = handleAttack(state, runtimes, id, now, colliders, map.safeZones, events);`.

`server/src/systems/police.ts`:
- сигнатуру `tickPolice(...): void` заменить на `): { cop: string; crim: string }[] {`, в начале тела `const arrests: { cop: string; crim: string }[] = [];`.
- после строки 74 (`if (cop) cop.cash += ARREST_BONUS;`) добавить `arrests.push({ cop: cop?.name ?? '', crim: crim.name });`.
- в конце тела `return arrests;`.

`server/src/rooms/CityRoom.ts`:
- импорт: `import { handleAttack, tickRespawn, type AttackResult, type KillEvent } from '../systems/combat.js';`
- обработчик `attack` (85-88) заменить на:
```ts
    this.onMessage('attack', (client) => {
      const events: KillEvent[] = [];
      const res = handleAttack(this.state, this.runtimes, client.sessionId, Date.now(), this.colliders, this.map.safeZones, events);
      this.broadcastAttack(res);
      this.broadcastKillEvents(events);
    });
```
- добавить приватный метод (рядом с `broadcastAttack`):
```ts
  // kill feed: убийства (и bounty) — общий broadcast ников
  private broadcastKillEvents(events: KillEvent[]): void {
    for (const ev of events) {
      const a = this.state.players.get(ev.killerId)?.name;
      const b = this.state.players.get(ev.victimId)?.name;
      if (!a || !b) continue;
      this.broadcast('feed', { kind: ev.bounty ? 'bounty' : 'kill', a, b });
    }
  }
```
- в `tick`: строку 417 (`const carHits = tickVehicles(...)`) заменить на:
```ts
    const killEvents: KillEvent[] = [];
    const carHits = tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots, this.map.safeZones, killEvents);
```
- после строки 420 (`for (const res of zombieAttacks) this.broadcastAttack(res);`) вставить `this.broadcastKillEvents(killEvents);` (tickZombies — добавить аргумент `killEvents` последним в вызов строки 419).
- строку 423 (`tickPolice(...)`) заменить на:
```ts
    const arrests = tickPolice(this.state, this.runtimes, now, dt, this.map);
    for (const a of arrests) this.broadcast('feed', { kind: 'arrest', a: a.cop, b: a.crim });
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `cd server && npx vitest run test/combat.test.ts test/police.test.ts test/zombies.test.ts test/vehicles.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add shared/src/config.ts server/src/systems/combat.ts server/src/systems/vehicles.ts server/src/systems/zombies.ts server/src/systems/police.ts server/src/rooms/CityRoom.ts server/test/combat.test.ts server/test/police.test.ts
git commit -m "feat(server): bounty 25$ за розыскного, kill/арест-события, broadcast feed"
```

---

### Task 9: Kill feed на клиенте

**Files:**
- Create: `client/src/feed.ts`
- Modify: `client/index.html:38` (div #feed)
- Modify: `client/src/style.css` (стили)
- Modify: `client/src/main.ts:75-76` (инициализация)

**Interfaces:**
- Consumes: broadcast `feed { kind, a, b }` (Task 8).
- Produces: `class Feed { constructor(); bind(room: Room): void }` — `bind` с самого начала (реконнект Task 16 перевяжет).

- [ ] **Step 1: HTML+CSS**

`client/index.html` после `<div id="toast" class="hidden"></div>` (38) добавить `<div id="feed"></div>`.

`client/src/style.css` в конец:
```css
#feed {
  position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column;
  align-items: flex-end; gap: 3px; pointer-events: none;
}
#feed div {
  color: #fff; font-size: 13px; background: rgba(0,0,0,.5);
  border-radius: 4px; padding: 3px 8px;
}
```

- [ ] **Step 2: feed.ts**

Создать `client/src/feed.ts`:
```ts
import type { Room } from 'colyseus.js';

const MAX_LINES = 5;
const TTL_MS = 5000;

// kill feed: серверные kill/bounty/arrest — правый верхний угол, строки тают за 5 сек
export class Feed {
  private root = document.getElementById('feed')!;

  bind(room: Room): void {
    room.onMessage('feed', (m: { kind: string; a: string; b: string }) => this.add(m));
  }

  private add(m: { kind: string; a: string; b: string }): void {
    const div = document.createElement('div');
    div.textContent = m.kind === 'arrest' ? `${m.a} арестовал ${m.b}`
      : m.kind === 'bounty' ? `${m.a} ☠ ${m.b} (+25$)`
      : `${m.a} ☠ ${m.b}`; // Task 14 заменит на t() — литералы осознанно временные
    this.root.append(div);
    while (this.root.children.length > MAX_LINES) this.root.firstElementChild?.remove();
    setTimeout(() => div.remove(), TTL_MS);
  }
}
```

- [ ] **Step 3: main.ts**

`client/src/main.ts`: импорт `import { Feed } from './feed.js';`; в `bootGame` после строки 76 (`room.onMessage('notice'...)`) добавить:
```ts
  const feed = new Feed();
  feed.bind(room);
```

- [ ] **Step 4: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто. (Feed используется — TS не ругнётся: переменная `feed` читается вызовом bind.)

- [ ] **Step 5: Commit**

```bash
git add client/src/feed.ts client/index.html client/src/style.css client/src/main.ts
git commit -m "feat(client): kill feed — убийства/аресты в правом верхнем углу"
```

---

### Task 10: Лидерборд (приложение «Рейтинг» в телефоне)

**Files:**
- Modify: `server/src/db.ts` (topByKills)
- Modify: `server/src/runtime.ts` (lastLbAt)
- Modify: `server/src/rooms/CityRoom.ts` (обработчик leaderboardReq)
- Modify: `client/index.html:50-51` (кнопка + экран)
- Modify: `client/src/phone.ts` (Screen, рендер)
- Modify: `client/src/style.css:108` (скролл-контейнер)
- Test: `server/test/db.test.ts` (topByKills), `server/test/phone.integration.test.ts` (leaderboardReq)

**Interfaces:**
- Produces: `GameDB.topByKills(limit?: number): { name: string; kills: number; deaths: number }[]`; `Runtime.lastLbAt: number`; сообщения `leaderboardReq` → `leaderboard { items: { name, kills, deaths }[] }`.

- [ ] **Step 1: Падающие тесты**

В `server/test/db.test.ts` добавить:
```ts
  it('topByKills: порядок по kills desc, лимит', () => {
    const db = new GameDB(':memory:');
    for (let i = 0; i < 12; i++) {
      db.save({ name: `p${i}`, cash: 0, safe: 0, apt: '', kills: i, deaths: 0, weapon: '', ammo: 0 });
    }
    const top = db.topByKills(10);
    expect(top).toHaveLength(10);
    expect(top[0]).toMatchObject({ name: 'p11', kills: 11 });
    expect(top[9]).toMatchObject({ name: 'p2', kills: 2 });
    db.close();
  });
```

В `server/test/phone.integration.test.ts` добавить:
```ts
  it('leaderboardReq → leaderboard с топом по убийствам', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'lb1', role: 'citizen' });
    (room as any).db.save({ name: 'champ', cash: 0, safe: 0, apt: '', kills: 42, deaths: 1, weapon: '', ammo: 0 });
    let msg: any = null;
    c1.onMessage('leaderboard', (m) => { msg = m; });
    c1.send('leaderboardReq');
    await wait(200);
    expect(msg.items[0]).toMatchObject({ name: 'champ', kills: 42 });
  });
```
(Хелпер `wait` в файле уже есть.)

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/db.test.ts test/phone.integration.test.ts`
Expected: FAIL — `topByKills`/обработчик не существуют.

- [ ] **Step 3: Сервер**

`server/src/db.ts` — после `getPlaytime` добавить:
```ts
  // топ по убийствам — лидерборд телефона
  topByKills(limit = 10): { name: string; kills: number; deaths: number }[] {
    return this.db.prepare('SELECT name, kills, deaths FROM players ORDER BY kills DESC, deaths ASC LIMIT ?').all(limit) as any[];
  }
```

`server/src/runtime.ts`: в интерфейс после `lastTransferHistAt` добавить `lastLbAt: number;         // leaderboardReq — свой лимит`; в `makeRuntime` после `lastTransferHistAt: -SMS_HISTORY_COOLDOWN_MS,` добавить `lastLbAt: -SMS_HISTORY_COOLDOWN_MS,`.

`server/src/rooms/CityRoom.ts` — после обработчика `transferHistoryReq` (189) добавить:
```ts
    this.onMessage('leaderboardReq', (client) => {
      const rt = this.runtimes.get(client.sessionId);
      const now = Date.now();
      if (!rt || now - rt.lastLbAt < SMS_HISTORY_COOLDOWN_MS) return;
      rt.lastLbAt = now;
      client.send('leaderboard', { items: this.db.topByKills(10) });
    });
```

- [ ] **Step 4: Клиент**

`client/index.html`:
- после `<button class="phoneApp" data-app="job">Работа</button>` (50) добавить `<button class="phoneApp" data-app="top">Рейтинг</button>`.
- после блока `#appJob` (74-78) добавить:
```html
      <div id="appTop" class="phoneScreen hidden">
        <div class="phoneBar"><button class="phoneBack">←</button><span>Рейтинг</span></div>
        <div id="topList"></div>
      </div>
```

`client/src/style.css:108` — селектор `#smsDialogs, #threadMsgs, #transferList` заменить на `#smsDialogs, #threadMsgs, #transferList, #topList`.

`client/src/phone.ts`:
- `type Screen` (7) заменить на `type Screen = 'phoneHome' | 'appSms' | 'appThread' | 'appBank' | 'appJob' | 'appTop';`
- в `show(s)` цикл (143) список заменить на `['phoneHome', 'appSms', 'appThread', 'appBank', 'appJob', 'appTop'] as Screen[]` и после строки 147 добавить `if (s === 'appTop') this.room.send('leaderboardReq');`
- в `openApp` (151-155) добавить `else if (app === 'top') this.show('appTop');`
- в конструктор, блок сети (после 88 `transferHistory`), добавить:
```ts
    room.onMessage('leaderboard', (m: any) => this.renderTop(m.items));
```
- добавить метод:
```ts
  private renderTop(items: { name: string; kills: number; deaths: number }[]): void {
    const box = document.getElementById('topList')!;
    box.textContent = '';
    items.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'transferRow';
      row.textContent = `${i + 1}. ${it.name} — ${it.kills}/${it.deaths}`; // убийства/смерти
      box.append(row);
    });
  }
```

- [ ] **Step 5: Прогнать — зелёное**

Run: `cd server && npx vitest run test/db.test.ts test/phone.integration.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/runtime.ts server/src/rooms/CityRoom.ts client/index.html client/src/phone.ts client/src/style.css server/test/db.test.ts server/test/phone.integration.test.ts
git commit -m "feat: лидерборд — приложение «Рейтинг» в телефоне (топ-10 по убийствам)"
```

---

## M5. Звуки

### Task 11: Серверные события picked/delivered + attacker в hit

**Files:**
- Modify: `server/src/systems/pickups.ts` (возврат PickedEvent[])
- Modify: `server/src/systems/economy.ts` (возврат DeliveredEvent[] из tickDelivery)
- Modify: `server/src/systems/combat.ts:19` (Hit += attacker), `server/src/systems/vehicles.ts:89`
- Modify: `server/src/rooms/CityRoom.ts` (дренаж + broadcast с attacker)
- Test: `server/test/pickups.test.ts`, `server/test/economy.test.ts` (возвраты), `server/test/room.integration.test.ts` (сообщения)

**Interfaces:**
- Consumes: сигнатуры Task 2 (`tickDelivery(state, map, now, runtimes)`).
- Produces: `interface PickedEvent { playerId: string; kind: string; amount: number }`, `tickPickups(...): PickedEvent[]`; `interface DeliveredEvent { playerId: string; reward: number }`, `tickDelivery(...): DeliveredEvent[]`; `Hit.attacker?: string`; адресные сообщения `picked { kind, amount }`, `delivered { reward }`; broadcast `hit` теперь всегда с `attacker` (sessionId).

- [ ] **Step 1: Падающие тесты**

В `server/test/pickups.test.ts` добавить:
```ts
  it('tickPickups возвращает события подбора (игрок, kind, amount)', () => {
    const state = new GameState();
    const p = new Player();
    p.name = 'looter';
    p.mode = 'foot';
    state.players.set('s1', p);
    spawnCashDrop(state, p.x, p.z, 77, 'cash-t1');
    const events = tickPickups(state, new Map(), 1000);
    expect(events).toEqual([{ playerId: 's1', kind: 'cash', amount: 77 }]);
  });
```

В `server/test/economy.test.ts` тест `'доставка в точку: награда от дистанции, груз снят'` дополнить: присвоить `const delivered = tickDelivery(state, map, 2000, runtimes);` и ожидать `expect(delivered).toEqual([{ playerId: 's1', reward: expected }]);`. Тест просрочки дополнить: `expect(tickDelivery(state, map, 1000 + DELIVERY_TIME_MS + 1, runtimes)).toEqual([]);`.

В `server/test/room.integration.test.ts` добавить:
```ts
  it('сдача груза шлёт адресное delivered, выстрел — hit с attacker', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'dl1', role: 'citizen' });
    // delivered: проставить груз вручную и подвезти к точке
    const p = room.state.players.get(c1.sessionId);
    p.mode = 'car';
    p.cargo = true;
    p.deliveryTarget = 'shop';
    p.deliveryDeadline = Date.now() + 60_000;
    let got: any = null;
    c1.onMessage('delivered', (m) => { got = m; });
    const t = (room as any).map.deliveryTargets.find((t: any) => t.id === 'shop');
    p.x = t.x; p.z = t.z;
    await new Promise(r => setTimeout(r, 200));
    expect(got?.reward).toBeGreaterThan(0);
  });
```
(Если tick 20 Гц не успевает — увеличить ожидание до 400 мс. `map` приватный — доступ как `(room as any).map`.)

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/pickups.test.ts test/economy.test.ts test/room.integration.test.ts`
Expected: FAIL — возвратов/сообщений нет.

- [ ] **Step 3: Реализация**

`server/src/systems/pickups.ts`:
- добавить `export interface PickedEvent { playerId: string; kind: string; amount: number }`.
- сигнатуру `tickPickups(...): void` заменить на `): PickedEvent[] {`, в начале `const events: PickedEvent[] = [];`.
- в `forEach` игроков добавить `id` игрока уже есть как `p`? Нет — `state.players.forEach((p) => {` заменить на `state.players.forEach((p, pid) => {`.
- в cash-ветке перед `state.pickups.delete(id);` вставить `events.push({ playerId: pid, kind: 'cash', amount: pk.amount });`.
- в weapon/ammo-ветке перед развилкой удаления/респауна вставить `events.push({ playerId: pid, kind: pk.kind, amount: 0 });`.
- в конце `return events;`.

`server/src/systems/economy.ts`:
- добавить `export interface DeliveredEvent { playerId: string; reward: number }`.
- `tickDelivery(state, map, now, runtimes): void` заменить на `): DeliveredEvent[] {` + `const events: DeliveredEvent[] = [];`; в успешной сдаче после `p.cash += reward;` вставить `events.push({ playerId: id, reward });`; в конце `return events;`.

`server/src/systems/combat.ts:19` — интерфейс `Hit` дополнить полем `attacker?: string; // sessionId атакующего (наезд/выстрел) — клиентскому звуку`.

`server/src/systems/vehicles.ts:89` — `hits.push({ victim: vid, damage, x: v.x, z: v.z });` заменить на `hits.push({ victim: vid, damage, x: v.x, z: v.z, attacker: car.driverId });`.

`server/src/rooms/CityRoom.ts`:
- `broadcastAttack` строку `for (const h of res.hits) this.broadcast('hit', h);` заменить на `for (const h of res.hits) this.broadcast('hit', { ...h, attacker: res.attacker }); // attacker — клиентскому hitDealt/hitTaken`.
- в `tick` строку 421 (`tickPickups(...)`) заменить на:
```ts
    for (const ev of tickPickups(this.state, this.pickupRuntime, now)) {
      this.clients.find(c => c.sessionId === ev.playerId)?.send('picked', { kind: ev.kind, amount: ev.amount });
    }
```
- строку с `tickDelivery(...)` заменить на:
```ts
    for (const ev of tickDelivery(this.state, this.map, now, this.runtimes)) {
      this.clients.find(c => c.sessionId === ev.playerId)?.send('delivered', { reward: ev.reward });
    }
```

- [ ] **Step 4: Прогнать — зелёное**

Run: `cd server && npx vitest run test/pickups.test.ts test/economy.test.ts test/room.integration.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add server/src/systems/pickups.ts server/src/systems/economy.ts server/src/systems/combat.ts server/src/systems/vehicles.ts server/src/rooms/CityRoom.ts server/test/pickups.test.ts server/test/economy.test.ts server/test/room.integration.test.ts
git commit -m "feat(server): события picked/delivered адресно, attacker в broadcast hit"
```

---

### Task 12: Звуки клиента (WebAudio-синтез) + mute по N

**Files:**
- Modify: `client/src/effects.ts` (синтез, подписки, update(me))
- Modify: `client/src/main.ts` (передать me в effects.update, тост delivered)
- Modify: `client/src/ui.ts` (тост mute — нет, тост через effects? Нет: mute-тост делает UI. См. Step 2)

**Interfaces:**
- Consumes: `picked`, `delivered`, `hit { attacker }` (Task 11).
- Produces: `Effects.cashIn(): void` (публичный — main.ts дёргает на `delivered`); `Effects.update(me?: { mode: string }): void` (новая сигнатура); `Effects.muted: boolean`.

- [ ] **Step 1: effects.ts — синтез**

`client/src/effects.ts`:
- поля дополнить:
```ts
  private muted = localStorage.getItem('mute') === '1';
  private prevMode = '';
```
- конструктор: в конец добавить глушилку и подписку на пикапы:
```ts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !e.repeat) this.toggleMute();
    });
    room.onMessage('picked', (m: { kind: string }) => {
      // подбор: деньги — «монетка», остальное — короткий блип
      if (m.kind === 'cash') this.tone(660, 0.12, 'sine', 0.07, 990);
      else this.tone(520, 0.08, 'square', 0.05);
    });
```
- метод `click()` (49-60) заменить универсальным синтезом:
```ts
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('mute', this.muted ? '1' : '0');
    return this.muted;
  }

  // доставка оплачена: восходящая «монетка» (main.ts дёргает на 'delivered')
  cashIn(): void {
    this.tone(523, 0.25, 'sine', 0.08, 1046);
  }

  // мини-синтез без ассетов: тон с экспоненциальным затуханием, опциональный слайд частоты
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.08, slideTo = 0): void {
    if (this.muted) return;
    try {
      this.audio ??= new AudioContext();
      const t0 = this.audio.currentTime;
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(t0 + dur);
    } catch { /* звук опционален, без него играбельно */ }
  }
```
- вызов `this.click()` в `onShot` (45) заменить на `this.tone(1200, 0.06, 'square', 0.06);`.
- в `onHit` (62) в начало тела добавить:
```ts
    const myId = this.room.sessionId;
    if (msg.attacker === myId && msg.victim !== myId) this.tone(880, 0.05, 'square', 0.05); // я попал
    if (msg.victim === myId) this.tone(140, 0.15, 'sawtooth', 0.09); // по мне
```
(сигнатуру `onHit` расширить типом `attacker?: string` в msg.)
- `update()` заменить сигнатуру и в начало добавить:
```ts
  update(me?: { mode: string }): void {
    if (me && me.mode === 'dead' && this.prevMode !== 'dead') this.tone(300, 0.5, 'sawtooth', 0.09, 60); // моя смерть
    if (me) this.prevMode = me.mode;
```
(поле `room` в конструкторе уже есть как `private room` — проверить: конструктор `(private scene, private room, private avatars)` — да, `this.room` доступен.)

- [ ] **Step 2: main.ts — проводка**

`client/src/main.ts`:
- строку 100 `effects.update();` заменить на `effects.update(me ?? undefined);`.
- после `feed.bind(room);` (Task 9) добавить:
```ts
  room.onMessage('delivered', (m: { reward: number }) => {
    ui.showToast(`+${m.reward}$`); // Task 14 заменит на t()
    effects.cashIn();
  });
```
- mute-тост: в `bootGame` после `effects` добавить подписку? Нет — `toggleMute` вызывается внутри effects; тост там недоступен. Добавить в main.ts:
```ts
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && !e.repeat) ui.showToast(effects.muted ? 'Звук выключен' : 'Звук включён'); // Task 14 → t()
  });
```
(порядок слушателей: effects переключает раньше/позже — оба на keydown без stopPropagation; effects.toggleMute отработает в своём слушателе, main читает уже новое значение, если effects зарегистрирован раньше — он создан раньше, ок.)

- [ ] **Step 3: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто. (`this.prevMode` сравнение со строкой — `mode` в state типизирован union'ом, ок.)

- [ ] **Step 4: Commit**

```bash
git add client/src/effects.ts client/src/main.ts
git commit -m "feat(client): WebAudio-звуки (выстрел, попадания, пикапы, доставка, смерть), mute по N"
```

---

## M4. Локализация RU/EN

### Task 13: i18n-ядро и словари

**Files:**
- Create: `client/src/i18n/ru.ts`
- Create: `client/src/i18n/en.ts`
- Create: `client/src/i18n/index.ts`

**Interfaces:**
- Produces: `type Lang = 'ru' | 'en'`; `t(key: string, params?: Record<string, string | number>): string`; `getLang(): Lang`; `setLang(l: Lang): void`; `applyStatic(): void` (раскладка по `data-i18n`/`data-i18n-ph`). Отсутствующий ключ → fallback на ru, затем сам ключ.

- [ ] **Step 1: ru.ts — полный словарь**

Создать `client/src/i18n/ru.ts`:
```ts
// Русский словарь (язык по умолчанию). Ключи — точка-нотация по модулям.
export const ru: Record<string, string> = {
  'join.nickPh': 'Ник',
  'join.citizen': 'Гражданин',
  'join.cop': 'Полицейский',
  'join.needName': 'Введи ник',
  'join.badToken': 'Этот ник уже занят другим игроком',
  'join.badVersion': 'Обновите страницу (новая версия сервера)',
  'join.banned': 'Аккаунт заблокирован',
  'join.full': 'Сервер полон (100/100) или недоступен — попробуйте позже',
  'role.citizen': 'Гражданин',
  'role.cop': 'Полицейский',
  'role.zombie': 'Зомби',
  'player.unknown': 'игрок',
  'stats.cash': 'Наличные',
  'stats.safe': 'Сейф',
  'stats.apt': 'Квартира',
  'stats.weapon': 'Оружие',
  'stats.fists': 'Кулаки',
  'banner.jail': 'ТЮРЬМА',
  'banner.wanted': 'В РОЗЫСКЕ',
  'banner.cargo': 'Груз → {target}: {sec} сек (+{reward}$)',
  'prompt.takeCargo': 'E — взять груз',
  'prompt.exitCar': 'E — выйти из машины',
  'prompt.gunShop': 'E — оружейный магазин',
  'prompt.safe': 'E — сейф',
  'prompt.rent': 'E — аренда {price}$',
  'prompt.enterCar': 'E — сесть в машину',
  'dialog.safe': 'Сейф',
  'dialog.shop': 'Оружейный магазин',
  'dialog.close': 'Закрыть',
  'dialog.depAll': 'Всё',
  'dialog.wdAll': 'Снять всё',
  'dialog.ammo': 'Патроны +{size} ({price}$)',
  'shop.ok': 'Куплено',
  'shop.too_far': 'Подойди ближе к магазину',
  'shop.no_money': 'Не хватает денег',
  'shop.bad_kind': 'Нет такого оружия',
  'shop.error': 'Ошибка покупки',
  'shop.row': '{name} — урон {dmg}, дальность {range} м',
  'weapon.bat': 'Бита',
  'weapon.pistol': 'Пистолет',
  'weapon.rifle': 'Винтовка',
  'weapon.ammo': 'Патроны',
  'target.shop': 'Магазин',
  'target.gas': 'Заправка',
  'target.port': 'Порт',
  'chat.ph': 'Сообщение… (Enter — отправить, Esc — отмена)',
  'phone.hint': 'P — телефон',
  'phone.sms': 'SMS',
  'phone.bank': 'Банк',
  'phone.job': 'Работа',
  'phone.top': 'Рейтинг',
  'sms.toPh': 'Ник получателя',
  'sms.ph': 'SMS…',
  'bank.transfer': 'Перевести',
  'bank.toPh': 'Ник',
  'bank.sumPh': 'Сумма',
  'bank.balance': 'Наличные: {cash}$',
  'job.active': 'Заказ: груз → {target}. Осталось {sec} сек. Награда {reward}$. Сдача — доехать до точки на машине.',
  'job.noneCar': 'Заказа нет. Взять доставку можно прямо отсюда (машина у тебя).',
  'job.noneFoot': 'Заказа нет. Для доставки нужна машина.',
  'job.take': 'Взять заказ',
  'job.drop': 'Отказаться от заказа',
  'job.need_car': 'Нужно быть в машине',
  'job.no_job': 'Нет активного заказа',
  'job.job_cooldown': 'Новый заказ будет через 30 секунд',
  'job.error': 'Ошибка заказа',
  'toast.transferOk': 'Переведено',
  'toast.transferIn': 'Перевод от {from}: +{amount}$',
  'toast.smsFrom': 'SMS от {from}',
  'sms.bad_to': 'Некорректный ник',
  'sms.self': 'Нельзя писать себе',
  'sms.bad_text': 'Пустое или длинное сообщение',
  'sms.cooldown': 'Не так быстро',
  'sms.no_such_user': 'Нет такого игрока',
  'sms.muted': 'Вы замьючены',
  'sms.error': 'Ошибка SMS',
  'transfer.bad_amount': 'Сумма от 1 до 100000',
  'transfer.self': 'Нельзя себе',
  'transfer.no_such_user': 'Нет такого игрока',
  'transfer.no_money': 'Не хватает наличных',
  'transfer.need_playtime': 'Переводы доступны после 30 минут игры',
  'transfer.ip_limit': 'Дневной лимит переводов с вашего IP исчерпан',
  'transfer.error': 'Ошибка перевода',
  'notice.muted': 'Вы замьючены до {time}',
  'world.hospital': 'Больница',
  'world.police': 'Полиция',
  'world.warehouse': 'Склад',
  'world.house': 'Жилой дом',
  'world.gunshop': 'Оружейный магазин',
  'world.safezone': 'Безопасная зона',
  'world.graveyard': 'Кладбище',
  'feed.kill': '{a} ☠ {b}',
  'feed.bounty': '{a} ☠ {b} (+{reward}$)',
  'feed.arrest': '{a} арестовал {b}',
  'death.title': 'Вы погибли',
  'death.timer': 'Респаун через {sec}',
  'reconnect': 'Соединение потеряно. Переподключение…',
  'sound.on': 'Звук включён',
  'sound.off': 'Звук выключен',
  'touch.attack': 'Удар',
  'touch.run': 'Бег',
};
```

- [ ] **Step 2: en.ts**

Создать `client/src/i18n/en.ts` (те же ключи):
```ts
import type { ru } from './ru.js';

// English dictionary. Ключи обязаны совпадать с ru (тип Record<keyof typeof ru, string>).
export const en: Record<keyof typeof ru, string> = {
  'join.nickPh': 'Nick',
  'join.citizen': 'Citizen',
  'join.cop': 'Police officer',
  'join.needName': 'Enter a nick',
  'join.badToken': 'This nick is taken by another player',
  'join.badVersion': 'Refresh the page (new server version)',
  'join.banned': 'Account banned',
  'join.full': 'Server is full (100/100) or unavailable — try later',
  'role.citizen': 'Citizen',
  'role.cop': 'Police officer',
  'role.zombie': 'Zombie',
  'player.unknown': 'player',
  'stats.cash': 'Cash',
  'stats.safe': 'Safe',
  'stats.apt': 'Flat',
  'stats.weapon': 'Weapon',
  'stats.fists': 'Fists',
  'banner.jail': 'JAIL',
  'banner.wanted': 'WANTED',
  'banner.cargo': 'Cargo → {target}: {sec}s (+{reward}$)',
  'prompt.takeCargo': 'E — take cargo',
  'prompt.exitCar': 'E — exit car',
  'prompt.gunShop': 'E — gun shop',
  'prompt.safe': 'E — safe',
  'prompt.rent': 'E — rent {price}$',
  'prompt.enterCar': 'E — enter car',
  'dialog.safe': 'Safe',
  'dialog.shop': 'Gun shop',
  'dialog.close': 'Close',
  'dialog.depAll': 'All',
  'dialog.wdAll': 'Withdraw all',
  'dialog.ammo': 'Ammo +{size} ({price}$)',
  'shop.ok': 'Purchased',
  'shop.too_far': 'Get closer to the shop',
  'shop.no_money': 'Not enough money',
  'shop.bad_kind': 'No such weapon',
  'shop.error': 'Purchase error',
  'shop.row': '{name} — damage {dmg}, range {range} m',
  'weapon.bat': 'Bat',
  'weapon.pistol': 'Pistol',
  'weapon.rifle': 'Rifle',
  'weapon.ammo': 'Ammo',
  'target.shop': 'Shop',
  'target.gas': 'Gas station',
  'target.port': 'Port',
  'chat.ph': 'Message… (Enter — send, Esc — cancel)',
  'phone.hint': 'P — phone',
  'phone.sms': 'SMS',
  'phone.bank': 'Bank',
  'phone.job': 'Job',
  'phone.top': 'Top players',
  'sms.toPh': 'Recipient nick',
  'sms.ph': 'SMS…',
  'bank.transfer': 'Send',
  'bank.toPh': 'Nick',
  'bank.sumPh': 'Amount',
  'bank.balance': 'Cash: {cash}$',
  'job.active': 'Order: cargo → {target}. {sec}s left. Reward {reward}$. Deliver by car.',
  'job.noneCar': 'No order. Take a delivery right here (you have a car).',
  'job.noneFoot': 'No order. You need a car for delivery.',
  'job.take': 'Take order',
  'job.drop': 'Drop order',
  'job.need_car': 'You must be in a car',
  'job.no_job': 'No active order',
  'job.job_cooldown': 'New order in 30 seconds',
  'job.error': 'Order error',
  'toast.transferOk': 'Sent',
  'toast.transferIn': 'Transfer from {from}: +{amount}$',
  'toast.smsFrom': 'SMS from {from}',
  'sms.bad_to': 'Invalid nick',
  'sms.self': 'Cannot message yourself',
  'sms.bad_text': 'Empty or too long message',
  'sms.cooldown': 'Not so fast',
  'sms.no_such_user': 'No such player',
  'sms.muted': 'You are muted',
  'sms.error': 'SMS error',
  'transfer.bad_amount': 'Amount from 1 to 100000',
  'transfer.self': 'Cannot send to yourself',
  'transfer.no_such_user': 'No such player',
  'transfer.no_money': 'Not enough cash',
  'transfer.need_playtime': 'Transfers unlock after 30 minutes of play',
  'transfer.ip_limit': 'Daily transfer limit for your IP reached',
  'transfer.error': 'Transfer error',
  'notice.muted': 'You are muted until {time}',
  'world.hospital': 'Hospital',
  'world.police': 'Police',
  'world.warehouse': 'Warehouse',
  'world.house': 'Apartment building',
  'world.gunshop': 'Gun shop',
  'world.safezone': 'Safe zone',
  'world.graveyard': 'Cemetery',
  'feed.kill': '{a} ☠ {b}',
  'feed.bounty': '{a} ☠ {b} (+{reward}$)',
  'feed.arrest': '{a} arrested {b}',
  'death.title': 'You died',
  'death.timer': 'Respawn in {sec}',
  'reconnect': 'Connection lost. Reconnecting…',
  'sound.on': 'Sound on',
  'sound.off': 'Sound off',
  'touch.attack': 'Fire',
  'touch.run': 'Run',
};
```
(Тип `Record<keyof typeof ru, string>` — компилятор сам следит за полнотой en.)

- [ ] **Step 3: index.ts ядра**

Создать `client/src/i18n/index.ts`:
```ts
import { ru } from './ru.js';
import { en } from './en.js';

export type Lang = 'ru' | 'en';
const dicts: Record<Lang, Record<string, string>> = { ru, en };

// выбор языка: сохранённый → navigator → ru
let lang: Lang = (() => {
  const saved = localStorage.getItem('lang');
  if (saved === 'ru' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
})();

export function getLang(): Lang { return lang; }

export function setLang(l: Lang): void {
  lang = l;
  localStorage.setItem('lang', l);
}

// отсутствующий ключ: fallback ru → сам ключ (заметно в dev)
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// статика index.html: data-i18n="key" → textContent, data-i18n-ph="key" → placeholder
export function applyStatic(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh!); });
}
```

- [ ] **Step 4: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто (en полон — иначе TS ошибка по `Record<keyof typeof ru, string>`).

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/
git commit -m "feat(client): i18n-ядро (t/setLang/applyStatic) и словари ru/en"
```

---

### Task 14: Миграция клиента на t() + переключатель языка

**Files:**
- Modify: `client/index.html` (data-i18n атрибуты, кнопки RU/EN)
- Modify: `client/src/main.ts` (join-тексты, lang-кнопки, notice временно старый, `applyStatic`)
- Modify: `client/src/ui.ts` (все строки)
- Modify: `client/src/phone.ts` (все строки)
- Modify: `client/src/feed.ts` (строки)
- Modify: `client/src/effects.ts` — нет строк. Пропуск.
- Modify: `client/src/avatars.ts:65,205` (роли, fallback-ник)
- Modify: `client/src/world.ts:5-8,134,157,171` (3D-таблички)
- Modify: `client/src/minimap.ts:36-41` (POI)
- Modify: `client/src/pickups.ts:5` (подписи пикапов)

**Interfaces:**
- Consumes: `t/setLang/applyStatic` (Task 13).
- Produces: `targetLabel(id: string): string` helper — нет, используем `t('target.' + id)` инлайн. `TARGET_LABELS` из shared на клиенте больше не используется (остаётся в shared для совместимости, сервер его не показывает).

- [ ] **Step 1: index.html — data-i18n и кнопки языка**

- `<input id="nameInput" ... placeholder="Ник" />` → `placeholder` убрать, добавить `data-i18n-ph="join.nickPh"`.
- `<button id="joinCitizen">` текст → `data-i18n="join.citizen"`; `<button id="joinCop">` → `data-i18n="join.cop"`.
- в `#join` после `.roles` добавить:
```html
    <div class="roles">
      <button id="langRu">RU</button>
      <button id="langEn">EN</button>
    </div>
```
- `#safeDialog` первый `<div>Сейф</div>` → `<div data-i18n="dialog.safe"></div>`; `#depAll` → `data-i18n="dialog.depAll"`; `#wdAll` → `data-i18n="dialog.wdAll"`; `#safeClose` → `data-i18n="dialog.close"`.
- `#shopDialog` заголовок → `data-i18n="dialog.shop"`; `#shopClose` → `data-i18n="dialog.close"`. (`#buyAmmoBtn` и `#dep100`/`#wd100` — числа/динамика, не трогаем.)
- `#chatInput` placeholder → `data-i18n-ph="chat.ph"`.
- `#phoneHint` текст `P — телефон ` → `<span data-i18n="phone.hint"></span> ` (бейдж оставить).
- `#phoneHome`: кнопки SMS/Банк/Работа — тексты обернуть: SMS → `<span data-i18n="phone.sms"></span>` (бейдж внутри кнопки сохранить), Банк → `data-i18n="phone.bank"`, Работа → `data-i18n="phone.job"`.
- `#appSms` bar-заголовок `<span>SMS</span>` → `<span data-i18n="phone.sms"></span>`; `#smsNewTo` placeholder → `data-i18n-ph="sms.toPh"`.
- `#threadInput` placeholder → `data-i18n-ph="sms.ph"`.
- `#appBank` bar → `data-i18n="phone.bank"`; `#transferTo` → `data-i18n-ph="bank.toPh"`; `#transferAmount` → `data-i18n-ph="bank.sumPh"`; `#transferBtn` → `data-i18n="bank.transfer"`.
- `#appJob` bar → `data-i18n="phone.job"`.
- `#appTop` bar (Task 10) → `data-i18n="phone.top"`.
- `#deathTitle` → `data-i18n="death.title"`.

- [ ] **Step 2: main.ts**

`client/src/main.ts`:
- импорты: `import { t, setLang, getLang, applyStatic } from './i18n/index.js';`
- вверху модуля после импортов: `applyStatic();` (статика экрана входа сразу на языке).
- после объявления `nameInput` добавить:
```ts
document.getElementById('langRu')!.addEventListener('click', () => { setLang('ru'); applyStatic(); });
document.getElementById('langEn')!.addEventListener('click', () => { setLang('en'); applyStatic(); });
```
- `joinError.textContent = 'Введи ник';` → `t('join.needName')`.
- блок текстов входа (36-42) заменить на:
```ts
    joinError.textContent = msg.includes('bad_token')
      ? t('join.badToken')
      : msg.includes('bad_version')
      ? t('join.badVersion')
      : msg.includes('banned')
      ? t('join.banned')
      : t('join.full');
```
- обработчик `notice` (76) заменить на (Task 15 приведёт код `muted`; пока — оба формата):
```ts
  room.onMessage('notice', (m: { code?: string; until?: number; text?: string }) => {
    if (m?.code === 'muted' && m.until) {
      const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
      ui.showToast(t('notice.muted', { time: new Date(m.until).toLocaleTimeString(locale) }));
    } else if (m?.text) ui.showToast(String(m.text)); // переходный формат до Task 15
  });
```
- тосты Task 12: `` `+${m.reward}$` `` → `t('toast.transferOk')`? Нет — delivered: `ui.showToast(\`+${m.reward}$\`)` оставить числом (универсально). mute-тост: `effects.muted ? 'Звук выключен' : 'Звук включён'` → `ui.showToast(t(effects.muted ? 'sound.off' : 'sound.on'))`.

- [ ] **Step 3: ui.ts**

- импорт: `import { t } from './i18n/index.js';` (TARGET_LABELS из импорта `@mmo/shared` убрать).
- `shopResult` тексты (50-54) заменить на:
```ts
    room.onMessage('shopResult', (msg: any) => {
      this.showToast(msg.ok ? t('shop.ok') : t(`shop.${msg.reason}`));
    });
```
- shopRow label (62): `label.textContent = \`${w.name} — урон ${w.damage}, дальность ${w.range} м\`;` → `label.textContent = t('shop.row', { name: t(`weapon.${kind}`), dmg: w.damage, range: w.range });`
- `buyAmmoBtn` (69): `t('dialog.ammo', { size: AMMO_PACK_SIZE, price: AMMO_PACK_PRICE })`.
- stats-блок (Task 5): `roleRu` → `t(me.role === 'cop' ? 'role.cop' : 'role.citizen')`; textContent:
```ts
    this.stats.textContent =
      `${t('stats.cash')}: ${me.cash}$  |  ${t('stats.safe')}: ${me.safe}$\n` +
      `${roleRu}${me.apt ? `  |  ${t('stats.apt')}: ${me.apt}` : ''}\n` +
      `${t('stats.weapon')}: ${w ? t(`weapon.${me.weapon}`) : t('stats.fists')}`;
```
- баннеры: jail → `` `${t('banner.jail')}: ${…} сек` `` (сек → вынести? число+сек: RU 'сек', EN 's' — использовать t('banner.jail') + ': ' + sec + ' ' + t('death.timer')? Нет — проще: `${t('banner.jail')}: ${sec}` — секунды числом, единицы не пишем (как в bounty). wanted аналогично. cargo: `t('banner.cargo', { target: t(`target.${me.deliveryTarget}`), sec, reward })`.
- death timer: `t('death.timer', { sec: left })`.
- computePrompt: все строки → `t('prompt.takeCargo')`, `t('prompt.exitCar')`, `t('prompt.gunShop')`, `t('prompt.safe')`, `t('prompt.rent', { price: RENT_PRICE })`, `t('prompt.enterCar')`.

- [ ] **Step 4: phone.ts**

- импорт: `import { t } from './i18n/index.js';` (TARGET_LABELS убрать из импорта shared).
- `update()`: jobInfo → `t('job.active', { target: t(`target.${me.deliveryTarget}`), sec: left, reward })`; noneCar/noneFoot → `t('job.noneCar')`/`t('job.noneFoot')`; кнопка → `t('job.drop')`/`t('job.take')`; bankBalance → `t('bank.balance', { cash: me.cash })`.
- `jobResult` обработчик: `this.toast(t(`job.${m.error}`))` с fallback `t('job.error')` — реализовать через `const key = \`job.${m.error}\`; this.toast(t(key) === key ? t('job.error') : t(key));` (t вернёт ключ при промахе).
- `smsErrorText`/`transferErrorText`: тела заменить на `const key = \`sms.${error}\`; return t(key) === key ? t('sms.error') : t(key);` и аналогично `transfer.`.
- `transferResult`: `this.toast(m.ok ? t('toast.transferOk') : this.transferErrorText(m.error))`.
- `transferIn`: `t('toast.transferIn', { from: m.from, amount: m.amount })`.
- `onSms`: `t('toast.smsFrom', { from: m.from })`.

- [ ] **Step 5: feed.ts, avatars.ts, world.ts, minimap.ts, pickups.ts**

`client/src/feed.ts` — `add()`:
```ts
    div.textContent = m.kind === 'arrest' ? t('feed.arrest', { a: m.a, b: m.b })
      : m.kind === 'bounty' ? t('feed.bounty', { a: m.a, b: m.b, reward: BOUNTY_REWARD })
      : t('feed.kill', { a: m.a, b: m.b });
```
(импорты `t`, `BOUNTY_REWARD` из `@mmo/shared`.)

`client/src/avatars.ts:65` — `roleRu` → `t(`role.${role}`)` с fallback: `role === 'cop' ? t('role.cop') : role === 'zombie' ? t('role.zombie') : t('role.citizen')`; `:205` — `p.name ?? 'игрок'` → `p.name ?? t('player.unknown')`. Импорт `t`.

`client/src/world.ts` — LABELS (5-8): значения → `t('world.hospital')` и т.д.; `:134` → `poi(map.gunShop, t('world.gunshop'))`; `:157` → `makeTextSprite(t('world.safezone'))`; `:171` → `makeTextSprite(t('world.graveyard'))`. Импорт `t`.

`client/src/minimap.ts` — pois (36-41): label'ы → `t('world.hospital')`, `t('world.police')`, `t('world.warehouse')`, `t('world.gunshop')`, и `...map.deliveryTargets.map(t0 => ({ x: t0.x, z: t0.z, label: t(`target.${t0.id}`) }))`. Импорт `t`; `TARGET_LABELS` из импорта убрать.

`client/src/pickups.ts:5` — KIND_LABELS: `bat: t('weapon.bat'), pistol: t('weapon.pistol'), rifle: t('weapon.rifle'), ammo: t('weapon.ammo')`. Импорт `t`. (Если литералы лежат в module-level константе — перенести вычисление в функцию/геттер, чтобы язык применялся при вызове: сделать `function kindLabel(kind: string): string { return t(`weapon.${kind}`); }` и использовать её вместо объекта.)

- [ ] **Step 6: Прогнать**

Run: `npm run typecheck && npm test` (из корня)
Expected: чисто и зелёно (серверные тексты ещё старые — notice обрабатывается обоими форматами).

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "feat(client): вся статика и динамика на t(), переключатель RU/EN на экране входа"
```

---

### Task 15: Сервер отдаёт notice кодом + PROTOCOL_VERSION=3

**Files:**
- Modify: `server/src/rooms/CityRoom.ts:113`
- Modify: `shared/src/config.ts:2`
- Modify: `server/test/moderation.integration.test.ts:29-36`
- Modify: `client/src/main.ts` (убрать переходный формат)

**Interfaces:**
- Produces: `notice { code: 'muted', until: number }`; `PROTOCOL_VERSION = 3`.

- [ ] **Step 1: Тест обновить (падающий)**

`server/test/moderation.integration.test.ts` — проверку (36) заменить на:
```ts
    expect(notice).toMatchObject({ code: 'muted' });
    expect(notice.until).toBeGreaterThan(Date.now());
```

Run: `cd server && npx vitest run test/moderation.integration.test.ts`
Expected: FAIL — сервер шлёт `{ text }`.

- [ ] **Step 2: Реализация**

`server/src/rooms/CityRoom.ts:113` заменить на:
```ts
        client.send('notice', { code: 'muted', until: mute.until }); // текст собирает клиент (i18n)
```

`shared/src/config.ts:2` — `PROTOCOL_VERSION = 2` → `= 3`.

`client/src/main.ts` — обработчик `notice`: удалить ветку `else if (m?.text)` (переходный формат больше не нужен — старые клиенты отвергнуты версией).

- [ ] **Step 3: Прогнать — зелёное**

Run: `cd server && npx vitest run test/moderation.integration.test.ts && cd .. && npm test && npm run typecheck`
Expected: все PASS (интеграционные вход шлёт актуальный `ver` из shared — бамп подхватывается сам), typecheck чистый.

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/CityRoom.ts shared/src/config.ts server/test/moderation.integration.test.ts client/src/main.ts
git commit -m "feat: notice кодом (muted/until), PROTOCOL_VERSION=3"
```

---

## M6. Реконнект

### Task 16: Прозрачный реконнект клиента (reconnectionToken)

**Files:**
- Create: нет
- Modify: `client/src/net.ts` (serverUrl + reconnect)
- Modify: `client/src/input.ts` (setRoom, this.room в замыканиях)
- Modify: `client/src/avatars.ts` (attach/rebind)
- Modify: `client/src/pickups.ts` (attach/rebind)
- Modify: `client/src/effects.ts` (bind)
- Modify: `client/src/ui.ts` (bind)
- Modify: `client/src/phone.ts` (bind)
- Modify: `client/src/prediction.ts` (reset)
- Modify: `client/src/main.ts` (полная переработка — код ниже)
- Modify: `client/index.html` (оверлей), `client/src/style.css` (стиль)

**Interfaces:**
- Consumes: `client.reconnect(room.reconnectionToken)` (colyseus.js 0.16, `Client.d.ts:42`, `Room.d.ts:15`); серверное окно `allowReconnection(client, 10)` уже есть (`CityRoom.ts:273`).
- Produces: `reconnect(reconnectionToken: string): Promise<Room>` (net.ts); `Avatars.rebind(room)`, `Pickups.rebind(room)`, `Effects.bind(room)`, `UI.bind(room)`, `Phone.bind(room)`, `InputController.setRoom(room)`, `Prediction.reset()`.

- [ ] **Step 1: net.ts**

Заменить всё содержимое `client/src/net.ts` на:
```ts
import { Client, type Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// за https (прод, nginx терминирует TLS) — wss на тот же хост без порта; локально — ws на :2567
function serverUrl(): string {
  return (import.meta as any).env?.VITE_SERVER_URL
    ?? (location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.hostname}:2567`);
}

export async function connect(name: string, role: string): Promise<Room> {
  const client = new Client(serverUrl());
  const token = localStorage.getItem(`tok:${name}`) ?? ''; // клейм ника из прошлого входа
  const room = await client.join('city', { name, role, token, ver: PROTOCOL_VERSION }); // join-only: комнату создаёт сервер
  room.onMessage('authToken', (m: { token: string }) => {
    if (m?.token) localStorage.setItem(`tok:${name}`, m.token);
  });
  return room;
}

// прозрачный реконнект: токен из room.reconnectionToken, окно 10 с держит сервер (allowReconnection)
export function reconnect(reconnectionToken: string): Promise<Room> {
  return new Client(serverUrl()).reconnect(reconnectionToken);
}
```

- [ ] **Step 2: bind-паттерн в классах**

`client/src/input.ts`:
- замыкания на параметр `room` заменить на `this.room`: строка 27 (`room.send('interact')`), строка 39 (`room.send('attack')`), строка 51 (`room.send('input', this.current)`) → `this.room.send(...)`.
- добавить метод:
```ts
  // реконнект: новая комната — шлем input в неё (слушатели DOM не привязаны к room)
  setRoom(room: Room): void {
    this.room = room;
  }
```
(поле `private room` в конструкторе — не readonly, переприсваивается.)

`client/src/prediction.ts` — добавить метод:
```ts
  // реконнект: сброс — следующий update жёстко примет серверную позицию
  reset(): void {
    this.active = false;
  }
```

`client/src/avatars.ts`:
- тело конструктора (192-236) перенести в приватный метод `private attach(room: Room): void { ... }` (внутри `this.room = room;` первой строкой; поле конструктора `private room` — не readonly).
- конструктор заменить на:
```ts
  constructor(private scene: THREE.Scene, room: Room) {
    this.attach(room);
  }

  // реконнект: меши старой комнаты снести, новая пришлёт состояние заново (onAdd на всех)
  rebind(room: Room): void {
    this.players.forEach(m => this.scene.remove(m.group));
    this.cars.forEach(m => this.scene.remove(m.group));
    this.players.clear();
    this.cars.clear();
    this.playerSnaps.clear();
    this.carSnaps.clear();
    this.attach(room);
  }
```
- в `attach` вместо `room.onStateChange(...)` и `getStateCallbacks(room)` — те же вызовы с параметром `room`.

`client/src/pickups.ts`:
- тело конструктора (55-73) перенести в `private attach(room: Room): void { this.room = room; ... }` (поле — не readonly).
- конструктор: `constructor(private scene: THREE.Scene, room: Room) { this.attach(room); }`
- добавить:
```ts
  // реконнект: снести все пикапы — новая комната перешлёт коллекцию
  rebind(room: Room): void {
    this.items.forEach((entry) => {
      this.dispose(entry);
      this.scene.remove(entry.group);
    });
    this.items.clear();
    this.attach(room);
  }
```

`client/src/effects.ts`:
- из конструктора перенести `room.onMessage('shot' | 'hit' | 'swing' | 'picked', ...)` в метод:
```ts
  // реконнект: сообщения подписываем на новую комнату (DOM-слушатель N остаётся в конструкторе)
  bind(room: Room): void {
    this.room = room;
    room.onMessage('shot', (msg: any) => this.onShot(room.sessionId, msg));
    room.onMessage('hit', (msg: any) => this.onHit(msg));
    room.onMessage('swing', (msg: any) => this.avatars.playSwing(msg.player));
    room.onMessage('picked', (m: { kind: string }) => {
      if (m.kind === 'cash') this.tone(660, 0.12, 'sine', 0.07, 990);
      else this.tone(520, 0.08, 'square', 0.05);
    });
  }
```
(поле `private room` — не readonly.) Конструктор: `constructor(private scene: THREE.Scene, room: Room, private avatars: Avatars) { this.bind(room); window.addEventListener('keydown', ...KeyN...); }`.

`client/src/ui.ts`:
- из конструктора перенести в `bind(room: Room)`: `room.onMessage('openSafe'...)`, `room.onMessage('openShop'...)`, `room.onMessage('shopResult'...)`, `room.onMessage('chat'...)`, `room.onMessage('chatHistory'...)`, `room.send('chatHistoryReq');`. Поле `private room` — не readonly; `bind` первой строкой `this.room = room;`. Конструктор: сохранить DOM-слушатели и вызвать `this.bind(room);`.

`client/src/phone.ts`:
- из конструктора перенести в `bind(room: Room)` весь блок «Сеть» (smsInbox, sms, smsResult, smsHistory, smsThread, transferResult, transferIn, transferHistory, jobResult, leaderboard). Поле `private room` — не readonly; `bind` первой строкой `this.room = room;`. Конструктор вызывает `this.bind(room);`.

`client/src/feed.ts` — уже с `bind(room)` (Task 9), не трогаем.

- [ ] **Step 3: main.ts — полная новая версия**

Заменить всё содержимое `client/src/main.ts` на:
```ts
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect, reconnect } from './net.js';
import { Avatars } from './avatars.js';
import { InputController } from './input.js';
import { Prediction } from './prediction.js';
import { updateCamera } from './camera.js';
import { UI } from './ui.js';
import { Effects } from './effects.js';
import { Pickups } from './pickups.js';
import { CityMapRenderer, type MapMarker } from './minimap.js';
import { Fullmap } from './fullmap.js';
import { Phone } from './phone.js';
import { Feed } from './feed.js';
import { TouchControls } from './touch.js'; // Task 18; до него — строку не добавлять
import { t, setLang, getLang, applyStatic } from './i18n/index.js';
import type { Room } from 'colyseus.js';

applyStatic(); // статика экрана входа — сразу на языке пользователя

const joinScreen = document.getElementById('join')!;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;

document.getElementById('langRu')!.addEventListener('click', () => { setLang('ru'); applyStatic(); });
document.getElementById('langEn')!.addEventListener('click', () => { setLang('en'); applyStatic(); });

let connecting = false;

async function start(role: string): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = t('join.needName');
    return;
  }
  if (connecting) return;
  connecting = true;
  let room: Room;
  try {
    room = await connect(name, role);
  } catch (e: any) {
    connecting = false;
    const msg = String(e?.message ?? '');
    joinError.textContent = msg.includes('bad_token')
      ? t('join.badToken')
      : msg.includes('bad_version')
      ? t('join.badVersion')
      : msg.includes('banned')
      ? t('join.banned')
      : t('join.full');
    return;
  }
  joinScreen.style.display = 'none';
  document.getElementById('hud')!.classList.remove('hidden');
  await waitLiveState(room);
  bootGame(room);
}

// первый ROOM_STATE приходит отдельным сообщением после join/reconnect, и в нём
// serverTime ещё 0 — ждём живое значение, иначе поля state undefined и съезжают таймеры
async function waitLiveState(room: Room): Promise<void> {
  while (!room.state.serverTime) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }
}

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // чёткость на Retina; кап 2 — перф
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const map = buildWorld(scene);
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  const ui = new UI(room, map, avatars, input);
  const effects = new Effects(scene, room, avatars);
  const pickups = new Pickups(scene, room);
  const mapRenderer = new CityMapRenderer(map);
  const fullmap = new Fullmap(mapRenderer, input);
  const phone = new Phone(room, map, input, (text) => ui.showToast(text), () => avatars.serverNow());
  const feed = new Feed();
  const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  const prediction = new Prediction();
  const overlay = document.getElementById('reconnectOverlay')!;
  let current = room;
  let lastCarId = '';
  let reconnecting = false;

  phone.onOpen = () => fullmap.close();
  fullmap.onOpen = () => phone.close();
  feed.bind(current);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && !e.repeat) ui.showToast(t(effects.muted ? 'sound.off' : 'sound.on'));
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // сообщения комнаты + onLeave: вызывается на старте и после каждого реконнекта
  const bindRoomMessages = (r: Room): void => {
    r.onMessage('notice', (m: { code?: string; until?: number }) => {
      if (m?.code === 'muted' && m.until) {
        const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
        ui.showToast(t('notice.muted', { time: new Date(m.until).toLocaleTimeString(locale) }));
      }
    });
    r.onMessage('delivered', (m: { reward: number }) => {
      ui.showToast(`+${m.reward}$`);
      effects.cashIn();
    });
    r.onLeave((code) => void onLeave(code));
  };

  const onLeave = async (code: number): Promise<void> => {
    if (code === 4000) { location.reload(); return; } // кик/consented — окна реконнекта нет
    if (reconnecting) return;
    reconnecting = true;
    overlay.textContent = t('reconnect');
    overlay.classList.remove('hidden');
    const token = current.reconnectionToken;
    for (let i = 0; i < 10; i++) { // окно сервера 10 с (allowReconnection) — 10 попыток по секунде
      await new Promise(r => setTimeout(r, 1000));
      try {
        const fresh = await reconnect(token);
        await waitLiveState(fresh);
        current = fresh;
        avatars.rebind(fresh);
        pickups.rebind(fresh);
        effects.bind(fresh);
        ui.bind(fresh);
        phone.bind(fresh);
        feed.bind(fresh);
        input.setRoom(fresh);
        prediction.reset();
        bindRoomMessages(fresh);
        overlay.classList.add('hidden');
        reconnecting = false;
        return;
      } catch { /* сервер ещё держит место или недоступен — следующая попытка */ }
    }
    location.reload(); // окно вышло — на экран входа (токен клейма ника в localStorage)
  };

  bindRoomMessages(room);

  new TouchControls(input, { // Task 18; до него — блок не добавлять
    attack: () => current.send('attack'),
    interact: () => current.send('interact'),
    togglePhone: () => (phone.isOpen ? phone.close() : phone.open()),
    toggleMap: () => (fullmap.isOpen ? fullmap.close() : fullmap.open()),
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    input.refresh();
    const me = (current.state.players as any).get(current.sessionId);
    if (me) {
      const predicted = prediction.update(dt, input.current, me.mode, me.x, me.z);
      avatars.selfPos = predicted ? { x: prediction.x, z: prediction.z } : null;
      updateCamera(camera, avatars.selfPos?.x ?? me.x, avatars.selfPos?.z ?? me.z, input.yaw);
    }
    avatars.update(dt);
    effects.update(me ?? undefined);
    pickups.update();
    ui.update();
    if (me) {
      if (me.mode === 'car') lastCarId = me.carId;
      const markers: MapMarker[] = [];
      if (me.mode !== 'car' && lastCarId) {
        const car = (current.state.cars as any).get(lastCarId);
        if (!car || (car.driverId && car.driverId !== current.sessionId)) lastCarId = '';
        else markers.push({ x: car.x, z: car.z, kind: 'car' });
      }
      if (me.cargo) {
        const t0 = map.deliveryTargets.find(t1 => t1.id === me.deliveryTarget);
        if (t0) markers.push({ x: t0.x, z: t0.z, kind: 'target' });
      }
      const selfView = {
        x: avatars.selfPos?.x ?? me.x,
        z: avatars.selfPos?.z ?? me.z,
        rotY: me.rotY,
      };
      mapRenderer.renderMinimap(minimapCanvas, selfView, markers);
      fullmap.render(selfView, markers);
      phone.update();
    }
    renderer.render(scene, camera);
  });
}

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
```
**Важно:** импорт `TouchControls` и его блок — только при выполнении Task 18. В рамках Task 16 эти две помеченные строки НЕ добавлять (иначе typecheck упадёт — файла ещё нет).

- [ ] **Step 4: HTML+CSS оверлея**

`client/index.html` после `#deathOverlay` добавить `<div id="reconnectOverlay" class="hidden"></div>`.

`client/src/style.css` в конец:
```css
#reconnectOverlay {
  position: fixed; inset: 0; z-index: 9; display: flex;
  align-items: center; justify-content: center;
  background: rgba(0,0,0,.75); color: #fff; font-size: 22px;
}
```

- [ ] **Step 5: Прогнать**

Run: `npm run typecheck && npm test` (из корня)
Expected: чисто и зелёно (сервер не тронут).
Ручная проверка (в smoke Task 19): `npm run dev`, войти, в DevTools → Network → Offline на 3 сек → Online: оверлей «Соединение потеряно…» появляется и исчезает, игра продолжается с той же позиции.

- [ ] **Step 6: Commit**

```bash
git add client/
git commit -m "feat(client): прозрачный реконнект по reconnectionToken (bind-паттерн, оверлей)"
```

---

## M7. Адаптив + тач

### Task 17: Адаптивная вёрстка (брейкпоинты)

**Files:**
- Modify: `client/index.html:5` (viewport)
- Modify: `client/src/style.css` (медиа-запросы)

**Interfaces:**
- Produces: брейкпоинты 900px/700px. Миникарта на ≤700px масштабируется CSS'ом (буфер 200px не меняется).

- [ ] **Step 1: viewport**

`client/index.html:5` заменить на:
```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

- [ ] **Step 2: медиа-запросы**

`client/src/style.css` в конец:
```css
/* адаптив: узкие окна и мобильные */
@media (max-width: 900px) {
  #chat, #chatInput { width: 46vw; }
}
@media (max-width: 700px) {
  #hpbar { width: 160px; }
  #stats { top: 52px; font-size: 12px; }
  #ammoBig { font-size: 18px; }
  #banner { top: 50px; font-size: 16px; }
  #prompt { bottom: 110px; font-size: 15px; }
  #toast { bottom: 210px; }
  #minimap { width: 130px; height: 130px; bottom: 12px; right: 12px; }
  #phoneHint { display: none; } /* на таче своя кнопка телефона */
  #phone {
    inset: 0; width: auto; height: auto; right: 0; bottom: 0;
    border: none; border-radius: 0; padding: 16px; font-size: 16px;
  }
  .phoneApp { padding: 18px; font-size: 18px; }
  #jobBtn { padding: 16px; font-size: 17px; }
  #chat { bottom: 170px; max-height: 100px; }
  #chatInput { bottom: 134px; }
  #deathTitle { font-size: 30px; }
}
```

- [ ] **Step 3: Прогнать**

Run: `npm run typecheck` (из корня)
Expected: чисто. Ручная проверка в Task 19 (DevTools device toolbar: 1366×768, iPad, iPhone).

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/src/style.css
git commit -m "feat(client): адаптивная вёрстка — брейкпоинты 900/700px, телефон-оверлей на малых экранах"
```

---

### Task 18: Тач-управление

**Files:**
- Create: `client/src/touch.ts`
- Modify: `client/index.html` (touchUI)
- Modify: `client/src/style.css` (стили touchUI)
- Modify: `client/src/input.ts` (тач-вектор, спринт-тоггл, тап=атака)
- Modify: `client/src/fullmap.ts` (тач пан/pinch)
- Modify: `client/src/main.ts` (импорт и блок TouchControls — снять пометки Task 16)
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts` (touch.phone/touch.map)

**Interfaces:**
- Consumes: `InputController`, `Phone.open/close/isOpen`, `Fullmap.open/close/isOpen`.
- Produces: `class TouchControls` (авто-показ при `ontouchstart`); `InputController.setTouchMove(x, y)`, `setTouchLook(dYaw)`, `toggleTouchSprint()`.

- [ ] **Step 1: input.ts**

`client/src/input.ts`:
- поля дополнить:
```ts
  private touch = { x: 0, y: 0 }; // джойстик -1..1 (тач)
  private touchSprint = false;    // кнопка «Бег» — тоггл (тач)
```
- методы:
```ts
  setTouchMove(x: number, y: number): void { this.touch.x = x; this.touch.y = y; }
  setTouchLook(dYaw: number): void { this.yaw += dYaw; }
  toggleTouchSprint(): void { this.touchSprint = !this.touchSprint; }
```
- `setBlocked`: в `if (v) { ... }` добавить `this.touch = { x: 0, y: 0 }; this.touchSprint = false;`.
- `refresh()` заменить на:
```ts
  refresh(): void {
    const t = this.touch;
    this.current.up = this.keys.has('KeyW') || t.y < -0.3;
    this.current.down = this.keys.has('KeyS') || t.y > 0.3;
    this.current.left = this.keys.has('KeyA') || t.x < -0.3;
    this.current.right = this.keys.has('KeyD') || t.x > 0.3;
    this.current.sprint = this.keys.has('ShiftLeft') || this.touchSprint || Math.hypot(t.x, t.y) > 0.92;
    this.current.rotY = this.yaw;
  }
```
- обработчик `click` на canvas заменить на:
```ts
    dom.addEventListener('click', () => {
      if (this.blocked) return; // оверлей закрывается только своей клавишей — клик по canvas под ним игнорируем
      if ('ontouchstart' in window) { this.room.send('attack'); return; } // на таче pointer lock нет — тап = атака
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else this.room.send('attack');
    });
```

- [ ] **Step 2: touch.ts**

Создать `client/src/touch.ts`:
```ts
import type { InputController } from './input.js';

const STICK_RADIUS = 45; // px — ход нуба от центра базы

interface TouchHooks {
  attack(): void;
  interact(): void;
  togglePhone(): void;
  toggleMap(): void;
}

// Тач-управление: левый джойстик (движение/бег), свайп справа (камера), кнопки действий.
// Существует только на тач-устройствах; на десктопе конструктор ничего не показывает.
export class TouchControls {
  constructor(private input: InputController, hooks: TouchHooks) {
    if (!('ontouchstart' in window)) return;
    document.getElementById('touchUI')!.classList.remove('hidden');
    const stick = document.getElementById('stick')!;
    const nub = document.getElementById('nub')!;

    // --- джойстик ---
    let stickId = -1;
    const moveStick = (tx: number, ty: number) => {
      const r = stick.getBoundingClientRect();
      let dx = (tx - (r.left + r.width / 2)) / STICK_RADIUS;
      let dy = (ty - (r.top + r.height / 2)) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.input.setTouchMove(dx, dy);
      nub.style.left = `${35 + dx * STICK_RADIUS}px`;
      nub.style.top = `${35 + dy * STICK_RADIUS}px`;
    };
    const resetStick = (): void => {
      this.input.setTouchMove(0, 0);
      nub.style.left = '35px';
      nub.style.top = '35px';
    };
    stick.addEventListener('touchstart', (e) => {
      const t0 = e.changedTouches[0];
      stickId = t0.identifier;
      moveStick(t0.clientX, t0.clientY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === stickId) moveStick(t0.clientX, t0.clientY);
      }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === stickId) { stickId = -1; resetStick(); }
        if (t0.identifier === lookId) lookId = -1;
      }
    }, { passive: true });

    // --- камера: свайп по правой части экрана (не по кнопкам/оверлеям) ---
    let lookId = -1;
    let lastX = 0;
    window.addEventListener('touchstart', (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('#touchUI') || tgt.closest('#phone') || tgt.closest('#fullmap') || tgt.closest('button')) return;
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.clientX > window.innerWidth * 0.4 && lookId === -1 && t0.identifier !== stickId) {
          lookId = t0.identifier;
          lastX = t0.clientX;
        }
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === lookId) {
          this.input.setTouchLook((t0.clientX - lastX) * 0.006);
          lastX = t0.clientX;
        }
      }
    }, { passive: true });

    // --- кнопки ---
    const onTap = (id: string, fn: () => void): void => {
      document.getElementById(id)!.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
    };
    onTap('btnAttack', hooks.attack);
    onTap('btnE', hooks.interact);
    onTap('btnRun', () => this.input.toggleTouchSprint());
    onTap('btnPhone', hooks.togglePhone);
    onTap('btnMap', hooks.toggleMap);
  }
}
```
(Объявление `let lookId` используется в раннем `touchend` выше по коду — hoisting `let` в том же scope: `touchend`-колбэк исполняется после инициализации, TDZ не срабатывает. Если TS ругается — поднять `let lookId = -1; let lastX = 0;` выше блока джойстика.)

- [ ] **Step 3: HTML+CSS+словари**

`client/index.html` внутри `#hud` (перед `#vignette`) добавить:
```html
    <div id="touchUI" class="hidden">
      <div id="stick"><div id="nub"></div></div>
      <button id="btnAttack" data-i18n="touch.attack"></button>
      <button id="btnE">E</button>
      <button id="btnRun" data-i18n="touch.run"></button>
      <button id="btnPhone" data-i18n="touch.phone"></button>
      <button id="btnMap" data-i18n="touch.map"></button>
    </div>
```

`client/src/i18n/ru.ts` добавить: `'touch.phone': 'Телефон', 'touch.map': 'Карта',`. `client/src/i18n/en.ts`: `'touch.phone': 'Phone', 'touch.map': 'Map',`.

`client/src/style.css` в конец:
```css
#touchUI { position: fixed; inset: 0; pointer-events: none; z-index: 6; }
#stick {
  position: absolute; bottom: 30px; left: 30px; width: 120px; height: 120px;
  border-radius: 50%; background: rgba(255,255,255,.08);
  border: 2px solid rgba(255,255,255,.25); pointer-events: auto; touch-action: none;
}
#nub {
  position: absolute; left: 35px; top: 35px; width: 50px; height: 50px;
  border-radius: 50%; background: rgba(255,255,255,.3);
}
#touchUI button {
  position: absolute; width: 64px; height: 64px; border-radius: 50%;
  background: rgba(0,0,0,.45); color: #fff; font-size: 14px;
  border: 2px solid rgba(255,255,255,.3); pointer-events: auto; touch-action: none;
}
#btnAttack { right: 30px; bottom: 100px; width: 84px; height: 84px; font-size: 16px; }
#btnE { right: 130px; bottom: 40px; }
#btnRun { right: 40px; bottom: 200px; }
#btnPhone { right: 130px; bottom: 130px; }
#btnMap { right: 210px; bottom: 40px; }
```

- [ ] **Step 4: fullmap.ts — тач пан/pinch**

`client/src/fullmap.ts` в конструктор после mousedown-слушателя добавить:
```ts
    // тач: один палец — пан, два — pinch-зум
    let pinchDist = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault(); // не скроллить страницу под картой
      if (e.touches.length === 1 && this.dragging) {
        const fit = Math.min(this.canvas.width, this.canvas.height) / (MAP_HALF * 2);
        this.panX -= (e.touches[0].clientX - this.lastX) / (fit * this.zoom);
        this.panZ -= (e.touches[0].clientY - this.lastY) / (fit * this.zoom);
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2 && pinchDist > 0) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.zoom = Math.min(FULLMAP_MAX_ZOOM, Math.max(1, this.zoom * (d / pinchDist)));
        pinchDist = d;
      }
      this.renderNow();
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => { this.dragging = false; pinchDist = 0; });
```
(`dragging`, `lastX`, `lastY`, `zoom`, `panX`, `panZ` — существующие приватные поля, переиспользуются.)

- [ ] **Step 5: main.ts — подключить**

В `client/src/main.ts` раскомментировать/добавить две помеченные строки из Task 16: импорт `./touch.js` и блок `new TouchControls(...)` в `bootGame`.

- [ ] **Step 6: Прогнать**

Run: `npm run typecheck && npm test` (из корня)
Expected: чисто и зелёно. Ручная проверка в Task 19 (DevTools → iPhone, тапы/джойстик).

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "feat(client): тач-управление — джойстик, свайп-камера, кнопки, pinch на карте"
```

---

### Task 19: Финальная верификация + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test` (из корня)
Expected: typecheck чистый во всех трёх workspaces; все тесты зелёные. Зафиксировать фактическое число тестов (shared + server) из вывода.

- [ ] **Step 2: Ручной smoke**

`npm run dev`, два окна `http://localhost:5173`:
- доставка: баннер и телефон показывают награду от дистанции; отказ от заказа → повторный только через 30 сек;
- убить игрока с оружием → ствол лежит пикапом; убить зомби → упало 10-29$; убить розыскного → +25$ и строка bounty в feed;
- арест → строка в feed; «Рейтинг» в телефоне → топ с champ-никами;
- звуки: выстрел, попадание, подбор, доставка, смерть; N — mute;
- EN: кнопка EN на входе — весь интерфейс на английском;
- реконнект: DevTools → Offline 3 сек → Online — оверлей и продолжение игры;
- DevTools → iPhone SE: джойстик двигает, кнопки работают, телефон во весь экран.

- [ ] **Step 3: README**

В `README.md` обновить:
- «Управление»: добавить `N — звук вкл/выкл`; строку про тач (джойстик, свайп, кнопки).
- «Команды»: фактические числа тестов из Step 1.
- Описание: добавить «RU/EN локализация (переключатель на экране входа), прозрачный реконнект (10 с), лидерборд в телефоне, баунти за розыскных, дроп оружия/денег с трупов».
- «Известные ограничения MVP»: пункт про отсутствие реконнекта убрать; пункт про одинаковые ники убрать (закрыт ещё в P0 — проверить, что его нет).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — реконнект, i18n, тач, метагейм, актуальные числа тестов"
```
