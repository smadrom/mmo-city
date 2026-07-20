# План доработки — 2026-07-20 (hardening перед публичным открытием)

Снято с `main` (HEAD `7d26eca`). Основано на аудите кодовой базы (8-агентное изучение, все находки перепроверены по коду). Артефакт-отчёт: `mmo2game — Полное изучение проекта`.

**Цель:** закрыть системные долги, которые мешают открыть игру публично: утечка приватных полей, отсутствие аутентификации, инфляционная экономика, эксплойты целостности. После этапов A+B игру можно открывать наружу.

**Стек напоминание:** сервер Colyseus 0.16 (`@colyseus/schema` 3.x, есть `StateView`/`@view()`), better-sqlite3 WAL, tsx; клиент Three.js + Vite; общий `@mmo/shared` как сырой TS. Тесты — vitest, интеграционные через `@colyseus/testing` c `GAME_DB=':memory:'`.

## Глобальные ограничения (для каждой задачи)

- **Деньги — целые.** Переводы/магазин уже целочисленные; сейф и wire-путь — нет (задача B4). Новых дробных путей не добавлять.
- **Схема Player меняется** в A1 → клиент и сервер выкатывать вместе. Совместимость версий — задача B3.
- **Node ≥ 16.9** (`Object.hasOwn`). Тесты обязаны оставаться зелёными после каждой задачи: `npm test` из корня (shared + server).
- **Коммиты:** conventional-commits на русском, как в истории (`feat(server): …`, `fix(client): …`). Без AI-атрибуции.
- **Порядок:** этапы по возрастанию приоритета. Внутри этапа A1 делать первой (мало кода, максимум эффекта). B2 зависит от A2. B3 дополняет `onAuth` из A2.

---

## Этап A — P0: блокеры публичного открытия

### A1. Приватные поля — только владельцу (`StateView` / `@view()`) ✅

> **✅ Выполнено 2026-07-20** — коммит `5712915`. 193 теста зелёные (34 shared + 159 server), диф +15/−10. Чужие приватные поля приходят `undefined` (клиент их не получает), свои — синкаются.

**Финдинг:** Крит — `server/src/schema/GameState.ts:15-23`: `cash/safe/ammo/cargo/deliveryTarget/deliveryDeadline/jailUntil` реплицируются каждому клиенту → утечка балансов/инвентаря + поверхность для чит-интела.
**Проверено:** клиент читает эти поля только у себя (`me.*`), а у чужих читает лишь `weapon` и `wantedUntil` (`client/src/avatars.ts:282,292`) — эти два остаются публичными.
**Файлы:** `server/src/schema/GameState.ts`, `server/src/rooms/CityRoom.ts` (onJoin), `server/test/room.integration.test.ts`.

- [ ] **Шаг 1.** В `GameState.ts:1` добавить `view` и `StateView` в импорт (`StateView` реэкспортируется из `@colyseus/schema`):
  ```ts
  import { Schema, MapSchema, type, view } from '@colyseus/schema';
  ```
- [ ] **Шаг 2.** Пометить приватные поля `@view()` перед `@type()` (`GameState.ts:15-23`). Публичные (`name, role, x, y, z, rotY, hp, mode, carId, apt, wantedUntil, weapon`) не трогать:
  ```ts
  @view() @type('number') jailUntil = 0;
  @view() @type('number') cash = 0;
  @view() @type('number') safe = 0;
  @view() @type('boolean') cargo = false;
  @view() @type('string') deliveryTarget = '';
  @view() @type('number') deliveryDeadline = 0;
  @view() @type('number') ammo = 0;
  ```
- [ ] **Шаг 3.** В `CityRoom.ts` импортировать `StateView` из `@colyseus/schema` и в `onJoin` после `this.state.players.set(client.sessionId, p);` (строка 199) назначить вид владельцу:
  ```ts
  client.view = new StateView();
  client.view.add(p);
  ```
- [ ] **Шаг 4. Тест утечки** — добавить в `room.integration.test.ts` (клиент видит свой cash, но НЕ чужой):
  ```ts
  it('приватные поля видит только владелец (@view)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const a = await testServer.connectTo(room, { name: 'viewA', role: 'citizen' });
    const b = await testServer.connectTo(room, { name: 'viewB', role: 'citizen' });
    room.state.players.get(a.sessionId).cash = 999; // серверная авторитетная величина
    await a.waitForNextPatch();
    // на клиенте A: свой cash реплицирован, чужой (B) остаётся дефолтным 0
    expect((a.state.players.get(a.sessionId) as any).cash).toBe(999);
    expect((a.state.players.get(b.sessionId) as any).cash).toBe(0);
  });
  ```
- [ ] **Шаг 5.** `npm test -w server` → зелёно (существующие тесты читают `room.state` = авторитетное состояние сервера, не клиентский вид, поэтому не ломаются).
- [ ] **Шаг 6. Коммит:** `feat(server): приватные поля Player только владельцу через StateView/@view`

---

### A2. Аутентификация по нику + секрет-токен (`onAuth`)

**Финдинг:** Крит — `server/src/rooms/CityRoom.ts:172` (нет `onAuth`): личность = самоназначенный ник. Знание чужого ника = захват аккаунта.
**Подход (MVP):** при первом входе под ником сервер генерирует секрет и отдаёт его клиенту (клиент хранит в `localStorage`). Повторный вход требует совпадения секрета через `options.token`. Это связывает ник с секретом; без него ник свободен.
**Файлы:** `server/src/db.ts`, `server/src/rooms/CityRoom.ts`, `client/src/net.ts`, `client/src/main.ts`, `server/test/db.test.ts`, `server/test/room.integration.test.ts`.

- [ ] **Шаг 1. БД: колонка секрета.** В `db.ts` `migrate()` (после строки 55) добавить идемпотентную миграцию:
  ```ts
  if (!has('secret')) this.db.exec(`ALTER TABLE players ADD COLUMN secret TEXT NOT NULL DEFAULT ''`);
  ```
  В `PlayerRecord` (`db.ts:4-13`) добавить `secret: string;`. В `load()` (`db.ts:58-64`) для новой записи генерировать секрет: `import { randomUUID } from 'node:crypto';` и `secret: randomUUID()`; в `save()` (`db.ts:66-74`) добавить `secret` в INSERT/UPDATE и в список колонок. Для существующих записей `SELECT *` вернёт `secret` (пустой у старых).
- [ ] **Шаг 2. БД: проверка секрета.** Добавить метод:
  ```ts
  getAuth(name: string): { exists: boolean; secret: string } {
    const row = this.db.prepare('SELECT secret FROM players WHERE name = ?').get(name) as { secret: string } | undefined;
    return { exists: !!row, secret: row?.secret ?? '' };
  }
  ```
- [ ] **Шаг 3. Сервер: `onAuth`.** В `CityRoom` добавить метод (перед `onJoin`). Пустой секрет у существующей записи (старые аккаунты) — разрешаем и «клеймим» при первом входе:
  ```ts
  onAuth(_client: Client, options: { name?: string; token?: string }): { name: string } {
    const name = String(options?.name ?? '').slice(0, 16);
    if (!name) throw new Error('need_name');
    const auth = this.db.getAuth(name);
    if (auth.exists && auth.secret && options?.token !== auth.secret) throw new Error('bad_token');
    return { name };
  }
  ```
- [ ] **Шаг 4. Сервер: выдать секрет владельцу.** В `onJoin` заменить вычисление `name` (`CityRoom.ts:173`) на `const name = (client.auth as { name: string }).name;`, а после `this.db.load(name)` отправить актуальный секрет клиенту: `client.send('authToken', { token: rec.secret });`. (Фолбэк-ник `p{sessionId}` больше не нужен — пустой ник отклоняется в `onAuth`.)
- [ ] **Шаг 5. Клиент: хранить и слать токен.** В `client/src/net.ts` читать токен из `localStorage` по нику и слать его; принимать обновление:
  ```ts
  export async function connect(name: string, role: string): Promise<Room> {
    const url = (import.meta as any).env?.VITE_SERVER_URL ?? `ws://${location.hostname}:2567`;
    const client = new Client(url);
    const token = localStorage.getItem(`tok:${name}`) ?? '';
    const room = await client.joinOrCreate('city', { name, role, token });
    room.onMessage('authToken', (m: { token: string }) => localStorage.setItem(`tok:${name}`, m.token));
    return room;
  }
  ```
- [ ] **Шаг 6. Клиент: понятная ошибка.** В `client/src/main.ts:33-37` (`catch`) показать причину, если ник занят: заменить общий текст на проверку — при `bad_token` вывести «Этот ник уже занят другим игроком». (Colyseus отдаёт код ошибки в `e`; вывести дружелюбный текст.)
- [ ] **Шаг 7. Тест (db):** в `server/test/db.test.ts` — новый аккаунт получает непустой `secret`; `getAuth` для него `exists:true` и секрет совпадает; для несуществующего `exists:false`.
- [ ] **Шаг 8. Тест (integration):** в `room.integration.test.ts` — вход под ником даёт `authToken`; повторный вход с неверным `token` отклоняется (`connectTo` бросает), с верным — проходит и `cash` тот же. Мокать `authToken` через `client.onMessage`.
- [ ] **Шаг 9.** `npm test` из корня → зелёно.
- [ ] **Шаг 10. Коммит:** `feat(server): аутентификация по нику + секрет-токен (onAuth), клиент хранит токен`

> Замечание: это MVP-уровень (потеря `localStorage` = потеря клейма на ник). Достаточно для закрытого/полу-открытого запуска; полноценные аккаунты (пароль/OAuth) — отдельная веха.

---

### A3. Персистентная рента (рабочий периодический сток)

**Финдинг:** Low/усиливает инфляцию — `server/src/runtime.ts:46`: `nextRentAt` живёт только в `Runtime` и обнуляется релогином (`makeRuntime`), поэтому релог раз в час вечно избегает ренты.
**Подход:** персистить срок следующей ренты в БД; при входе восстанавливать в `Runtime`. Просроченная рента спишется сразу (`tickRent`).
**Файлы:** `server/src/db.ts`, `server/src/rooms/CityRoom.ts`, `server/test/db.test.ts`.

- [ ] **Шаг 1. БД: колонка.** В `migrate()` добавить: `if (!has('rent_due')) this.db.exec(\`ALTER TABLE players ADD COLUMN rent_due INTEGER NOT NULL DEFAULT 0\`);`
- [ ] **Шаг 2. PlayerRecord + load/save.** В `PlayerRecord` добавить `rentDueAt: number;`. В `load()` вернуть `rentDueAt: (row as any).rent_due ?? 0` (и `0` для новой записи). В `save()` писать колонку `rent_due` из значения `@rentDueAt`; вызывать `.run({ ...rec, rentDueAt: rec.rentDueAt ?? 0 })`, чтобы ключ всегда присутствовал (better-sqlite3 требует именованный параметр).
- [ ] **Шаг 3. CityRoom: сохранять и восстанавливать.** В `savePlayer` (`CityRoom.ts:244`) добавить в объект `db.save({ …, rentDueAt: rt.nextRentAt })`. В `onJoin` после создания `rt` (`CityRoom.ts:201-204`): `rt.nextRentAt = rec.rentDueAt || (Date.now() + RENT_INTERVAL_MS);` (импортировать `RENT_INTERVAL_MS` из `@mmo/shared`).
- [ ] **Шаг 4. Тест (db):** roundtrip — `save` записи с `rentDueAt: 123456`, затем `load` возвращает `rentDueAt === 123456`; у нового аккаунта `rentDueAt === 0`.
- [ ] **Шаг 5.** `npm test -w server` → зелёно.
- [ ] **Шаг 6. Коммит:** `fix(server): рента переживает релогин — nextRentAt персистится в БД`

---

### A4. Активная зарплата копа (анти-AFK-фарм)

**Финдинг:** Крит (эмиссия) — `server/src/systems/police.ts:20`: зарплата начисляется пассивно, гейт лишь `role==='cop' && mode!=='dead'` → AFK-коп фармит до 12 000/час на 20 копов.
**Подход:** платить, только если коп патрулировал (сдвинулся ≥ порога) за интервал. Окно и якорь двигаются в любом случае — AFK не копит «долг».
**Файлы:** `shared/src/config.ts`, `server/src/runtime.ts`, `server/src/systems/police.ts`, `server/src/rooms/CityRoom.ts` (onJoin), `server/test/police.test.ts`.

- [ ] **Шаг 1. Константа.** В `shared/src/config.ts` рядом с зарплатой (`:44-46`) добавить: `export const COP_PATROL_MIN_DIST = 30; // м между выплатами — иначе AFK`
- [ ] **Шаг 2. Runtime: якорь.** В `Runtime` (`runtime.ts:12-30`) добавить `salaryAnchorX: number;` и `salaryAnchorZ: number;`; в `makeRuntime` инициализировать `salaryAnchorX: 0, salaryAnchorZ: 0`.
- [ ] **Шаг 3. onJoin: якорь = спавн.** В `CityRoom.onJoin` после установки `p.x/p.z` и создания `rt`: `rt.salaryAnchorX = p.x; rt.salaryAnchorZ = p.z;`
- [ ] **Шаг 4. police.ts: гейт по движению.** Заменить блок зарплаты (`police.ts:20-23`):
  ```ts
  if (p.role === 'cop' && p.mode !== 'dead' && now >= rt.nextSalaryAt) {
    const moved = dist2(p.x, p.z, rt.salaryAnchorX, rt.salaryAnchorZ) >= COP_PATROL_MIN_DIST * COP_PATROL_MIN_DIST;
    if (moved) p.cash += COP_SALARY;
    rt.nextSalaryAt = now + COP_SALARY_INTERVAL_MS;
    rt.salaryAnchorX = p.x;
    rt.salaryAnchorZ = p.z;
  }
  ```
  Импортировать `COP_PATROL_MIN_DIST` в `police.ts:1-5`.
- [ ] **Шаг 5. Тест (police):** в `server/test/police.test.ts` — два кейса при `now >= nextSalaryAt`: (a) коп не двигался (позиция == якорь) → `cash` не вырос; (b) коп сдвинут на ≥30 м → `cash += COP_SALARY`. В обоих `nextSalaryAt` сдвинулся, якорь обновлён.
- [ ] **Шаг 6.** `npm test -w server` → зелёно.
- [ ] **Шаг 7. Коммит:** `fix(server): зарплата копа только за патруль (анти-AFK), сдвиг окна и якоря`

> Ограничение: бот, дёргающий позицию, всё ещё может фармить — это отдельная веха (anti-bot). Здесь закрыт тривиальный «зашёл копом и ушёл AFK».

---

## Этап B — P1: целостность и эксплойты

### B1. Починка ложного отказа перевода

**Финдинг:** High — `server/src/systems/economy.ts:85-86`: guard корректен (`p.cash<sum`), но `db.transfer` проверяет `WHERE cash>=amount` по БД, которая отстаёт до 5 с после свежего заработка → легитимный перевод отклоняется. **Дупликации денег нет.**
**Подход:** синхронизировать строку отправителя в БД с авторитетной памятью прямо перед транзакцией.
**Файлы:** `server/src/rooms/CityRoom.ts` (transfer handler), `server/test/economy.test.ts` или `room.integration.test.ts`.

- [ ] **Шаг 1.** В обработчике `transfer` (`CityRoom.ts:145-153`) добавить флаш отправителя ПЕРЕД `tryTransfer`:
  ```ts
  this.onMessage('transfer', (client, data) => {
    this.savePlayer(client.sessionId); // синк БД с памятью: cash авторитетен, иначе ложный no_money
    const res = tryTransfer(this.state, this.db, client.sessionId, data?.to, data?.amount, Date.now());
    ...
  });
  ```
- [ ] **Шаг 2. Тест (integration):** отправитель получает `DELIVERY_REWARD` в память (через `p.cash += …` напрямую в тесте, имитируя свежий заработок без сейва), сразу шлёт `transfer` на сумму больше стартового БД-баланса, но в пределах памяти → `transferResult.ok === true`, у получателя `cash` вырос.
- [ ] **Шаг 3.** `npm test -w server` → зелёно.
- [ ] **Шаг 4. Коммит:** `fix(server): перевод авторизуется по памяти — флаш отправителя перед db.transfer`

---

### B2. Уникальные активные ники + заморозка «призрака»

**Финдинг:** High — `server/src/rooms/CityRoom.ts:250` (дубли ников: last-write-wins, двойное начисление) и `:211` («призрак» до 10 с полностью симулируется: движется, арестуем, агрит зомби).
**Зависит от:** A2 (токен различает «это я реконнекчусь» vs «чужой под моим ником»).
**Файлы:** `server/src/runtime.ts`, `server/src/rooms/CityRoom.ts`, `server/src/systems/movement.ts`, `server/src/systems/police.ts`, `server/src/systems/zombies.ts`, `server/test/room.integration.test.ts`.

- [ ] **Шаг 1. Отказ дубля активного ника.** В `onAuth` (из A2) после проверки токена отклонять, если ник уже онлайн: `if (this.findSessionByName(name)) throw new Error('name_online');`. (Верный токен всё равно отклонит второй одновременный вход — это ожидаемо; реконнект восстанавливает через уже существующую сессию.)
- [ ] **Шаг 2. Флаг заморозки.** В `Runtime` добавить `frozen: boolean;` (в `makeRuntime` → `false`). В `onLeave` (`CityRoom.ts:208-215`) перед `allowReconnection` пометить: `const rt = this.runtimes.get(client.sessionId); if (rt) rt.frozen = true;`. При успешном реконнекте (если реализуется) и при `removePlayer` флаг снимать/запись удалять.
- [ ] **Шаг 3. Гварды.** Пропускать замороженных:
  - `movement.ts` `tickMovement`: в начале колбэка `forEach` — `const rt = runtimes.get(id); if (!rt || rt.frozen) return;` (движение и реген).
  - `police.ts` `tickPolice` блок арестов: замороженного преступника не арестовывать — `if (crt.frozen) { crt.arrestProgress = 0; return; }`.
  - `zombies.ts` `tickZombies`: цель-жертву выбирать только среди `!rt.frozen` (в фильтре агро-цели).
- [ ] **Шаг 4. Тест (integration):** клиент заходит, `leave()` (обрыв); в течение окна `frozen === true`, `input` больше не двигает игрока (позиция стабильна). Проверить `(room as any).runtimes.get(id).frozen`.
- [ ] **Шаг 5.** `npm test -w server` → зелёно.
- [ ] **Шаг 6. Коммит:** `fix(server): запрет дубля активного ника + заморозка призрака при обрыве`

---

### B3. Версионирование протокола

**Финдинг:** High — `README.md:72`: схема состояния меняется между версиями, обязательная совместная выкатка, нет version-хендшейка. Устаревший клиент рассинхронит поля.
**Зависит от:** A2 (проверка в том же `onAuth`).
**Файлы:** `shared/src/config.ts`, `client/src/net.ts`, `server/src/rooms/CityRoom.ts`, `server/test/room.integration.test.ts`.

- [ ] **Шаг 1. Константа.** В `shared/src/config.ts` добавить `export const PROTOCOL_VERSION = 1;` (инкрементить при изменении схемы/сообщений).
- [ ] **Шаг 2. Клиент шлёт версию.** В `net.ts` добавить `ver: PROTOCOL_VERSION` в `joinOrCreate('city', { name, role, token, ver: PROTOCOL_VERSION })` (импорт из `@mmo/shared`).
- [ ] **Шаг 3. Сервер проверяет.** В начале `onAuth` (до работы с БД): `if (options?.ver !== PROTOCOL_VERSION) throw new Error('bad_version');` (импорт `PROTOCOL_VERSION`).
- [ ] **Шаг 4. Клиент: сообщение.** В `main.ts` `catch` — при `bad_version` показать «Обновите страницу (новая версия сервера)».
- [ ] **Шаг 5. Тест (integration):** `connectTo(room, { name:'old', role:'citizen' })` без `ver` (или с чужим) → отклоняется; с `ver: PROTOCOL_VERSION` → проходит. (В тестах вход идёт напрямую — добавить `ver` в options валидных кейсов, иначе они начнут падать; обновить хелпер/опции.)
- [ ] **Шаг 6.** `npm test` из корня → зелёно.
- [ ] **Шаг 7. Коммит:** `feat(shared): PROTOCOL_VERSION — хендшейк версии в onAuth`

> Важно: шаг 5 требует добавить `ver: PROTOCOL_VERSION` во ВСЕ `connectTo(...)` в тестах (или завести тест-хелпер `join(room, opts)`). Иначе существующие интеграционные тесты начнут отклоняться. Рекомендую хелпер.

---

### B4. Целочисленность и rate-limit денежных операций

**Финдинг:** Med — `server/src/rooms/CityRoom.ts:92,95` (`deposit/withdraw`: `Math.abs(Number()||0)` без `Number.isInteger`, без rate-limit); `:139` (`smsRead` пишет БД без кулдауна); `:145` (`transfer` без кулдауна). Low — `housing.ts:38` (`adjustSafe` без целочисленности).
**Файлы:** `server/src/runtime.ts`, `server/src/rooms/CityRoom.ts`, `shared/src/config.ts`, `server/test/room.integration.test.ts`.

- [ ] **Шаг 1. Целые суммы сейфа.** В `CityRoom.ts:92,95` обернуть в `Math.floor`:
  ```ts
  adjustSafe(this.state, client.sessionId, Math.floor(Math.abs(Number(data?.amount) || 0)));
  // и withdraw: -Math.floor(Math.abs(Number(data?.amount) || 0))
  ```
- [ ] **Шаг 2. Кулдаун денежных сообщений.** В `shared/src/config.ts` добавить `export const MONEY_COOLDOWN_MS = 500;`. В `Runtime` добавить `lastMoneyAt: number;` (`makeRuntime` → `-MONEY_COOLDOWN_MS`). В обработчиках `deposit/withdraw/transfer/smsRead` в начале:
  ```ts
  const rt = this.runtimes.get(client.sessionId);
  if (!rt || Date.now() - rt.lastMoneyAt < MONEY_COOLDOWN_MS) return;
  rt.lastMoneyAt = Date.now();
  ```
  (Для `transfer` — после успешной валидации допустимо; проще в начале обработчика.)
- [ ] **Шаг 3. Тест (integration):** дробный `deposit { amount: 0.9 }` не меняет `safe`; спам `deposit` дважды подряд → второй игнорируется (проверить, что `safe` вырос ровно на один шаг).
- [ ] **Шаг 4.** `npm test` из корня → зелёно.
- [ ] **Шаг 5. Коммит:** `fix(server): целые суммы сейфа + rate-limit deposit/withdraw/transfer/smsRead`

---

### B5. Выход из машины через проверку коллизии

**Финдинг:** High — `server/src/systems/vehicles.ts:164-165`: `tryExitCar` ставит игрока на `car + dir·2` без проверки коллизии → можно оказаться внутри здания.
**Файлы:** `server/src/systems/vehicles.ts`, `server/src/rooms/CityRoom.ts` (вызов), `server/test/vehicles.test.ts`.

- [ ] **Шаг 1. Сигнатура.** Изменить `tryExitCar` — принимать коллайдеры и искать свободную точку среди кандидатов вокруг машины, фолбэк — центр машины:
  ```ts
  export function tryExitCar(state: GameState, playerId: string, colliders: AABB[]): boolean {
    const p = state.players.get(playerId);
    if (!p || p.mode !== 'car') return false;
    const car = state.cars.get(p.carId);
    if (car) {
      car.driverId = '';
      car.speed = 0;
      const cand = [
        [Math.cos(car.rotY) * 2, -Math.sin(car.rotY) * 2],
        [-Math.cos(car.rotY) * 2, Math.sin(car.rotY) * 2],
        [Math.sin(car.rotY) * 2, Math.cos(car.rotY) * 2],
        [-Math.sin(car.rotY) * 2, -Math.cos(car.rotY) * 2],
      ];
      let ox = 0, oz = 0;
      for (const [dx, dz] of cand) {
        if (!collidesAny(car.x + dx, car.z + dz, PLAYER_RADIUS, colliders)) { ox = dx; oz = dz; break; }
      }
      p.x = clamp(car.x + ox, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
      p.z = clamp(car.z + oz, -MAP_HALF + PLAYER_RADIUS, MAP_HALF - PLAYER_RADIUS);
    }
    p.mode = 'foot';
    p.carId = '';
    return true;
  }
  ```
  `collidesAny, clamp, MAP_HALF, PLAYER_RADIUS` уже импортированы в `vehicles.ts:1-6`.
- [ ] **Шаг 2. Вызов.** В `CityRoom.ts:272` передать коллайдеры: `tryExitCar(this.state, client.sessionId, this.colliders);`
- [ ] **Шаг 3. Тест (vehicles):** посадить игрока в машину вплотную к зданию так, чтобы дефолтная точка выхода была в коллайдере; после `tryExitCar` — `!collidesAny(p.x, p.z, PLAYER_RADIUS, colliders)`.
- [ ] **Шаг 4.** `npm test -w server` → зелёно.
- [ ] **Шаг 5. Коммит:** `fix(server): выход из машины ищет свободную точку (не телепорт в здание)`

---

### B6. Typecheck сервера/shared + CI

**Финдинг:** High — `server/package.json:6`: прод исполняет сырой TS через tsx; `tsc` гоняется только на клиенте → типовые регрессии сервера/shared уезжают молча. Нет CI.
**Файлы:** `server/package.json`, `shared/package.json`, `package.json` (root), `.github/workflows/ci.yml` (создать).

- [ ] **Шаг 1. Скрипты typecheck.** В `server/package.json` и `shared/package.json` добавить `"typecheck": "tsc --noEmit"` (tsconfig уже есть в обоих, extends `../tsconfig.base.json`). В корневой `package.json` добавить `"typecheck": "tsc --noEmit -p shared && tsc --noEmit -p server && npm run build -w client"`.
- [ ] **Шаг 2. Прогнать локально.** `npm run typecheck` из корня — устранить всплывшие типовые ошибки сервера/shared (если есть).
- [ ] **Шаг 3. CI.** Создать `.github/workflows/ci.yml`:
  ```yaml
  name: ci
  on: [push, pull_request]
  jobs:
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npm ci
        - run: npm run typecheck
        - run: npm test
  ```
- [ ] **Шаг 4. Node floor.** В корневой `package.json` добавить `"engines": { "node": ">=16.9" }` и файл `.nvmrc` со значением `20`.
- [ ] **Шаг 5. Коммит:** `chore: typecheck сервера/shared + CI (typecheck + tests) + engines/nvmrc`

---

## Этап C — P2: качество, перф, UX (не блокирует открытие)

### C1. Клиентские автотесты (предсказание/реконсиляция)

**Финдинг:** High — `client/package.json:5`: 0 тестов на 13 модулей.
**Файлы:** `client/package.json` (+vitest), `client/src/prediction.ts` (уже чистый — тестируем как есть), `client/test/prediction.test.ts` (создать).

- [ ] Добавить `vitest` в `client` devDeps и скрипт `"test": "vitest run"`; включить в корневой `npm test`.
- [ ] Тест `prediction.ts`: пешком `update` шагает `stepFoot` за кадр; реконсиляция — снап при d²>9, мягкий догон при 0.25..9, игнор при <0.25 (проверить пороги на числах).
- [ ] Тест дедупа входящих (SMS/переводы) — вынести чистую функцию дедупа из `phone.ts`, если ещё inline, и покрыть.
- [ ] **Коммит:** `test(client): юниты предсказания и реконсиляции движения`

### C2. Настоящий нагрузочный тест с метриками

**Финдинг:** Med — `server/loadtest/bots.ts:37`: пустой дым без ассертов/метрик/teardown; боты не шлют экономические сообщения.
- [ ] Добавить сбор метрик: средний/99p интервал тика (из `serverTime`-дельт), RSS-память до/после, число ошибок; `process.exit(1)` при деградации порога.
- [ ] Боты шлют `chat/sms/transfer/deposit/jobTake` со случайным разбросом (варьировать по индексу бота).
- [ ] Корректный teardown (закрыть всех клиентов, дождаться).
- [ ] **Коммит:** `test(server): нагрузочный тест с метриками тика/памяти и экономическими сообщениями`

### C3. Перф, supply-chain и мелочи UX

- [ ] **npm audit** (`docs/plan:64`): `npm audit fix`; если critical в неиспользуемой ветке colyseus/auth — зафиксировать в README как принятый риск.
- [ ] **Перф зомби** (`zombies.ts:9`): оценить стоимость 20 NPC в `state.players` (трафик/циклы); при заметной цене — вынести ИИ-агентов из реплики или интерполировать по зонам.
- [ ] **Перф рендера** (`effects.ts:32`, `world.ts:78`): дистанс-куллинг tracer'ов/цифр урона; слияние/инстансинг статики города.
- [ ] **UX телефон** (`client/src/ui.ts:81`): `stopPropagation` на Enter в полях телефона (не воровать фокус в игровой чат).
- [ ] **UX диалоги** (`ui.ts:26`): `setBlocked` для магазина/сейфа — WASD не двигают, клик не шлёт `attack`.
- [ ] **Дроп оружия** (`combat.ts:123`): опционально ронять оружие пикапом при смерти/аресте (сейчас исчезает молча) — дизайн-решение.
- [ ] **Общий хелпер** `buildingColliders(map)` в `@mmo/shared` (дедуп `CityRoom.ts:38` и `prediction.ts`); параметризовать геометрию от `MAP_HALF` (`map.ts:50`).
- [ ] **README sync:** числа тестов (реально 34 + ≈158, не 32 + 128), «реконнект» (его нет — `location.reload`), «кладбище» vs `zombieSpawns`, зомби-реген HP; закрепить Node.
- [ ] **Коммиты:** по одному на осмысленную группу.

---

## Как проверять (сквозное)

- После каждой задачи: `npm test` из корня (shared + server) — зелёно.
- После этапа B6: `npm run typecheck` из корня — зелёно.
- Ручной E2E: `npm run dev`, два окна `http://localhost:5173`. Ключевые новые проверки:
  - A1: во втором окне баланс/патроны первого игрока НЕ видны (только свои в HUD).
  - A2: перезаход тем же ником — тот же аккаунт; чужой под тем же ником без токена — «ник занят».
  - A3: арендовать квартиру, перезайти через час-эквивалент — рента списалась/квартира снята при нехватке.
  - A4: коп стоит AFK 5+ мин — зарплата не капает; патрулирует — капает.
  - B5: выйти из машины вплотную к стене — не оказаться внутри здания.
- Редеплой (клиент+сервер вместе, схема изменилась в A1) — по инструкции из `docs/plan-2026-07-19.md:47-55`.

## Порядок исполнения (рекомендация)

`A1 → A2 → A3 → A4 → B6(рано, включит CI) → B1 → B4 → B5 → B3 → B2 → C*`.
B2 и B3 завязаны на `onAuth` (A2); B6 раньше остальных B — чтобы CI ловил регрессии уже в этапе B.
