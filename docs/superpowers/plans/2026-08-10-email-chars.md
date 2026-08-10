# Email-регистрация + до 8 персонажей — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** обязательная регистрация по email (без подтверждения) и до 8 персонажей (ник+роль+свой прогресс) на аккаунт, с экраном выбора персонажа (лобби внутри комнаты).

**Architecture:** новые таблицы `accounts`(email+passhash) и `characters`(ник, email-владелец, роль); `players` остаётся прогрессом по нику. Вход: `onAuth` только по email+паролю (регистрация на месте) → клиент в комнате без `Player` (лобби) → сообщения `createChar`/`selectChar`/`deleteChar` → `spawnPlayer`. Ник+токен путь удаляется (жёсткий срез, `PROTOCOL_VERSION=6`).

**Tech Stack:** Colyseus 0.16 (`@colyseus/testing` интеграция), better-sqlite3, vitest; клиент Three.js+Vite; общий `@mmo/shared` (сырой TS).

**Spec:** `docs/superpowers/specs/2026-08-10-email-chars-design.md`

## Global Constraints

- Коммиты: conventional-commits на русском (`feat(server): …`), без AI-атрибуции.
- После каждой задачи зелёное: `npm test` из корня (shared+server), `npm run typecheck` из корня.
- Node ≥ 16.9 (`Object.hasOwn`). Тесты сервера: `GAME_DB=':memory:'` ставится в `beforeAll` ДО создания комнаты.
- Деньги целочисленные — новых дробных путей не добавлять (в этой фиче денег нет).
- Ник глобально уникален (PK в `characters`); баны/муты/админка/SMS/переводы остаются по нику.
- `client.auth` не хранит пароль дольше `onAuth`.

## Файловая структура

- Modify: `shared/src/config.ts` — `CHARACTER_LIMIT`, `PROTOCOL_VERSION` 5→6.
- Modify: `server/src/db.ts` — таблицы+методы аккаунтов/персонажей, миграция; удаление `getAuth/bindEmail/getByEmail`/secret-клейма.
- Modify: `server/src/rooms/CityRoom.ts` — новый `onAuth`, лобби-`onJoin`, сообщения лобби, `spawnPlayer`, `onLeave`.
- Create: `server/test/helpers.ts` — `joinWithChar`, `onceMessage`.
- Create: `server/test/chars.integration.test.ts` — новые сценарии лобби.
- Modify: `server/test/{room,ban,moderation,phone,antifarm,singleroom}.integration.test.ts`, `server/test/db.test.ts`.
- Delete: `server/test/email.integration.test.ts` (замещён chars.integration).
- Modify: `server/loadtest/bots.ts` — боты под новую регистрацию.
- Modify: `client/index.html`, `client/src/style.css`, `client/src/net.ts`, `client/src/main.ts`, `client/src/settings.ts`, `client/src/i18n/ru.ts`, `client/src/i18n/en.ts`.
- Modify: `README.md` — описание входа/персонажей.

---

### Task 1: БД — таблицы accounts/characters, методы, миграция (аддитивно)

Задача строго аддитивна: старые методы (`getAuth/bindEmail/getByEmail`, secret-клейм в `load`) НЕ удаляем — их сносит Task 2. После задачи всё зелёное.

**Files:**
- Modify: `shared/src/config.ts` (рядом с `MAX_PLAYERS`, строка 72)
- Modify: `server/src/db.ts`
- Test: `server/test/db.test.ts`

**Interfaces:**
- Produces (использует Task 2):
  - `CHARACTER_LIMIT = 8` (из `@mmo/shared`)
  - `db.getAccount(email: string): { email: string; passhash: string } | null`
  - `db.createAccount(email: string, passhash: string): void`
  - `db.listChars(email: string): { name: string; role: string }[]`
  - `db.countChars(email: string): number`
  - `db.getChar(name: string): { name: string; email: string; role: string } | null`
  - `db.createChar(email: string, name: string, role: string): void`
  - `db.deleteChar(name: string): void` — удаляет characters+players+SMS; transfers/transfer_log/bans/mutes НЕ трогает (аудит/анти-обход).

- [ ] **Step 1: падающие тесты** — добавить в `server/test/db.test.ts` (в существующий `describe`, паттерн временной БД как у имеющегося migrate-теста — `test-migrate-${Date.now()}.db`, cleanup после):

```ts
it('accounts/chars: createAccount/getAccount, createChar/listChars/countChars/getChar', () => {
  const db = new GameDB(':memory:');
  expect(db.getAccount('a@b.c')).toBeNull();
  db.createAccount('a@b.c', 'salt:hash');
  expect(db.getAccount('a@b.c')).toEqual({ email: 'a@b.c', passhash: 'salt:hash' });
  expect(db.countChars('a@b.c')).toBe(0);
  db.createChar('a@b.c', 'neo', 'citizen');
  db.createChar('a@b.c', 'trinity', 'cop');
  expect(db.countChars('a@b.c')).toBe(2);
  expect(db.listChars('a@b.c')).toEqual([
    { name: 'neo', role: 'citizen' },
    { name: 'trinity', role: 'cop' },
  ]);
  expect(db.getChar('neo')).toEqual({ name: 'neo', email: 'a@b.c', role: 'citizen' });
  expect(db.getChar('nobody')).toBeNull();
  // createChar создаёт и строку прогресса со стартовым капиталом
  expect(db.load('neo').cash).toBe(START_CASH);
  db.close();
});

it('deleteChar: чистит characters/players/sms; ник освобождается; бан не трогает', () => {
  const db = new GameDB(':memory:');
  db.createAccount('a@b.c', 'salt:hash');
  db.createChar('a@b.c', 'neo', 'citizen');
  db.addSms('neo', 'trinity', 'hi', 1);
  db.addSms('trinity', 'neo', 'yo', 2);
  db.ban('neo', '', 'test', null, false);
  db.deleteChar('neo');
  expect(db.getChar('neo')).toBeNull();
  expect(db.hasPlayer('neo')).toBe(false);
  expect(db.getDialogs('trinity')).toEqual([]); // SMS с ником стёрты
  expect(db.getActiveBan('neo', Date.now())).not.toBeNull(); // бан переживает удаление (анти-обход)
  db.createChar('a@b.c', 'neo', 'cop'); // ник освободился
  expect(db.getChar('neo')?.role).toBe('cop');
  db.close();
});

it('миграция: старый email-аккаунт переносится в accounts/characters', () => {
  const path = `test-migrate-chars-${Date.now()}.db`;
  const db1 = new GameDB(path);
  db1.load('oldnick'); // строка прогресса
  (db1 as any).db.prepare(`UPDATE players SET email = 'old@example.com', passhash = 'salt:hash' WHERE name = 'oldnick'`).run();
  db1.close();
  const db2 = new GameDB(path); // конструктор → migrate() → бэкфилл
  expect(db2.getAccount('old@example.com')).toEqual({ email: 'old@example.com', passhash: 'salt:hash' });
  expect(db2.getChar('oldnick')).toEqual({ name: 'oldnick', email: 'old@example.com', role: 'citizen' });
  db2.close();
  rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
});
```

(Вверху файла: `import { rmSync } from 'node:fs';` и `START_CASH` из `@mmo/shared` — если ещё не импортированы. Паттерн временной БД — как у имеющегося migrate-теста в этом же файле.)

- [ ] **Step 2: прогнать — падают**

Run: `cd server && npx vitest run test/db.test.ts`
Expected: FAIL — `db.getAccount is not a function`.

- [ ] **Step 3: константа** — `shared/src/config.ts` после строки `export const MAX_PLAYERS = 100;`:

```ts
export const CHARACTER_LIMIT = 8; // персонажей на одном email-аккаунте
```

- [ ] **Step 4: таблицы** — в `server/src/db.ts` в конструкторе, в общий `this.db.exec(...)` (после `mutes`, строка 68-72) добавить:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  email TEXT PRIMARY KEY,
  passhash TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  name TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created INTEGER NOT NULL
);
```

- [ ] **Step 5: миграция-бэкфилл** — в конец `migrate()` (после строки 90):

```ts
// жёсткий срез → старые email-привязки переносятся в accounts/characters (идемпотентно)
this.db.exec(`
  INSERT OR IGNORE INTO accounts (email, passhash, created)
    SELECT email, passhash, 0 FROM players WHERE email != '';
  INSERT OR IGNORE INTO characters (name, email, role, created)
    SELECT name, email, 'citizen', 0 FROM players WHERE email != '';
`);
```

- [ ] **Step 6: методы** — в `db.ts` после `getByEmail` (строка 126) добавить:

```ts
// --- аккаунты и персонажи (обязательная email-регистрация) ---

getAccount(email: string): { email: string; passhash: string } | null {
  const row = this.db.prepare('SELECT email, passhash FROM accounts WHERE email = ?').get(email) as { email: string; passhash: string } | undefined;
  return row ?? null;
}

createAccount(email: string, passhash: string): void {
  this.db.prepare('INSERT INTO accounts (email, passhash, created) VALUES (?, ?, ?)').run(email, passhash, Date.now());
}

listChars(email: string): { name: string; role: string }[] {
  return this.db.prepare('SELECT name, role FROM characters WHERE email = ? ORDER BY created, name').all(email) as { name: string; role: string }[];
}

countChars(email: string): number {
  const row = this.db.prepare('SELECT COUNT(*) AS c FROM characters WHERE email = ?').get(email) as { c: number };
  return row.c;
}

getChar(name: string): { name: string; email: string; role: string } | null {
  const row = this.db.prepare('SELECT name, email, role FROM characters WHERE name = ?').get(name) as { name: string; email: string; role: string } | undefined;
  return row ?? null;
}

createChar(email: string, name: string, role: string): void {
  this.db.prepare('INSERT INTO characters (name, email, role, created) VALUES (?, ?, ?, ?)').run(name, email, role, Date.now());
  this.load(name); // строка прогресса со стартовым капиталом
}

// удаление персонажа: прогресс и SMS стираем; transfers/transfer_log/bans/mutes — аудит, не трогаем
deleteChar(name: string): void {
  this.db.prepare('DELETE FROM characters WHERE name = ?').run(name);
  this.db.prepare('DELETE FROM players WHERE name = ?').run(name);
  this.db.prepare('DELETE FROM sms WHERE from_nick = ? OR to_nick = ?').run(name, name);
}
```

- [ ] **Step 7: прогнать — зелёные**

Run: `cd server && npx vitest run test/db.test.ts`
Expected: PASS (все, включая старые — старые методы не тронуты).

- [ ] **Step 8: Commit**

```bash
git add shared/src/config.ts server/src/db.ts server/test/db.test.ts
git commit -m "feat(server): таблицы accounts/characters + методы + миграция email-привязок"
```

---

### Task 2: Сервер — onAuth по email, лобби, персонажи + миграция всех server-тестов

Самая большая задача. Протокол меняется → `PROTOCOL_VERSION=6`. В конце `npm test` и typecheck сервера зелёные.

**Files:**
- Modify: `shared/src/config.ts:2` — `PROTOCOL_VERSION = 6`
- Modify: `server/src/db.ts` — удалить `getAuth` (110-114), `bindEmail` (116-119), `getByEmail` (121-126), secret-клейм в `load` (96-99), `secret`/`email` из `PlayerRecord` (14-15), `randomUUID` импорт (2), `secret` из INSERT в `load` (102-106)
- Modify: `server/src/rooms/CityRoom.ts`
- Create: `server/test/helpers.ts`
- Create: `server/test/chars.integration.test.ts`
- Delete: `server/test/email.integration.test.ts`
- Modify: `server/test/{room,ban,moderation,phone,antifarm,singleroom}.integration.test.ts`, `server/test/db.test.ts`
- Modify: `server/loadtest/bots.ts`

**Interfaces:**
- Consumes: методы БД и `CHARACTER_LIMIT` из Task 1; `hashPassword/verifyPassword` из `server/src/auth.ts` (уже импортированы в CityRoom).
- Produces (для клиента, Task 3): сообщения сервера → клиент: `charList { chars: {name,role}[], copFull }`, `lobbyError { code }`, `spawnOk { name }`; клиент → сервер: `createChar { name, role }`, `selectChar { name }`, `deleteChar { name }`; join-options: `{ email, password, ver }`.
- Produces (тест-хелпер): `joinWithChar(testServer, room, name, role?): Promise<Room>`, `onceMessage(client, type, ms?): Promise<any>` из `server/test/helpers.ts`.

- [ ] **Step 1: хелпер `server/test/helpers.ts`** (новый файл):

```ts
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from 'colyseus.js';
import { PROTOCOL_VERSION } from '@mmo/shared';

// Вход в новой модели: аккаунт = email (дёривируется из ника → ник = один аккаунт),
// персонаж создаётся createChar'ом; повторный вход того же ника → selectChar.
// Возвращает клиента уже заспавненным (spawnOk получен).
export async function joinWithChar(
  testServer: ColyseusTestServer,
  room: any,
  name: string,
  role: 'citizen' | 'cop' = 'citizen',
): Promise<Room> {
  const email = `${name.toLowerCase()}@t.local`;
  const client = await testServer.connectTo(room, { email, password: 'pw1234', ver: PROTOCOL_VERSION });
  const spawned = onceMessage(client, 'spawnOk');
  const exists = room.db.getChar(name); // серверная БД (приватное поле) — тесты лезут осознанно
  client.send(exists ? 'selectChar' : 'createChar', { name, role });
  await spawned;
  return client;
}

export function onceMessage<T = any>(client: Room, type: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting "${type}"`)), ms);
    const off = client.onMessage(type, (m: T) => { clearTimeout(timer); off(); resolve(m); });
  });
}
```

- [ ] **Step 2: новые падающие тесты `server/test/chars.integration.test.ts`** (новый файл):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import { Player, type GameState } from '../src/schema/GameState.js';
import { PROTOCOL_VERSION, CHARACTER_LIMIT, COP_LIMIT } from '@mmo/shared';
import { joinWithChar, onceMessage } from './helpers.js';

const OPTS = (email: string) => ({ email, password: 'pw1234', ver: PROTOCOL_VERSION });

describe('персонажи/лобби (integration)', () => {
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

  it('регистрация при входе: пустой charList, createChar спавнит с выбранной ролью', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await testServer.connectTo(room, OPTS('new@t.local'));
    const list = await onceMessage<{ chars: any[]; copFull: boolean }>(c, 'charList');
    expect(list.chars).toEqual([]);
    expect(list.copFull).toBe(false);
    expect(room.state.players.get(c.sessionId)).toBeUndefined(); // лобби — без Player
    const spawned = onceMessage(c, 'spawnOk');
    c.send('createChar', { name: 'hero', role: 'cop' });
    await spawned;
    const p = room.state.players.get(c.sessionId);
    expect(p.name).toBe('hero');
    expect(p.role).toBe('cop');
  });

  it('пустой email → need_email; слабый пароль нового аккаунта → weak_password; неверный → bad_password', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'anchor1'); // держит комнату
    await expect(testServer.connectTo(room, { ver: PROTOCOL_VERSION })).rejects.toThrow(/need_email/);
    await expect(testServer.connectTo(room, { email: 'weak@t.local', password: '123', ver: PROTOCOL_VERSION })).rejects.toThrow(/weak_password/);
    const c = await joinWithChar(testServer, room, 'pwduser');
    await c.leave();
    await new Promise(r => setTimeout(r, 200));
    await expect(testServer.connectTo(room, { email: 'pwduser@t.local', password: 'wrong1', ver: PROTOCOL_VERSION })).rejects.toThrow(/bad_password/);
  });

  it('второй одновременный вход того же аккаунта → account_online', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'dup');
    await expect(testServer.connectTo(room, OPTS('dup@t.local'))).rejects.toThrow(/account_online/);
  });

  it('лимит слотов: 9-й персонаж → slots_full', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    for (let i = 0; i < CHARACTER_LIMIT; i++) room.db.createChar('full@t.local', `slot${i}`, 'citizen');
    const c = await testServer.connectTo(room, OPTS('full@t.local'));
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'slot9', role: 'citizen' });
    expect((await err).code).toBe('slots_full');
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
  });

  it('ник занят другим аккаунтом → nick_taken; пустой ник → nick_bad; плохая роль → role_bad', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('other@t.local', 'taken', 'citizen');
    const c = await testServer.connectTo(room, OPTS('mine@t.local'));
    let err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'taken', role: 'citizen' });
    expect((await err).code).toBe('nick_taken');
    err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: '  ', role: 'citizen' });
    expect((await err).code).toBe('nick_bad');
    err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'okname', role: 'zombie' });
    expect((await err).code).toBe('role_bad');
  });

  it('cop_full: спавн копа при заполненном лимите отклоняется, гражданин проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // лимит копов заполнен фейковыми игроками (без runtime — тик их пропускает)
    for (let i = 0; i < COP_LIMIT; i++) {
      const fake = new Player();
      fake.name = `fakecop${i}`;
      fake.role = 'cop';
      room.state.players.set(`fake${i}`, fake);
    }
    const c = await testServer.connectTo(room, OPTS('copfan@t.local'));
    const list = await onceMessage<{ copFull: boolean }>(c, 'charList');
    expect(list.copFull).toBe(true);
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'copfan', role: 'cop' });
    expect((await err).code).toBe('cop_full');
    const spawned = onceMessage(c, 'spawnOk');
    c.send('createChar', { name: 'copfan', role: 'citizen' });
    await spawned;
    expect(room.state.players.get(c.sessionId).role).toBe('citizen');
  });

  it('selectChar чужого/несуществующего → not_found; свой — спавнит, роль из записи', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('other@t.local', 'theirs', 'cop');
    const c = await testServer.connectTo(room, OPTS('picker@t.local'));
    room.db.createChar('picker@t.local', 'mine', 'cop');
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('selectChar', { name: 'theirs' });
    expect((await err).code).toBe('not_found');
    const spawned = onceMessage(c, 'spawnOk');
    c.send('selectChar', { name: 'mine' });
    await spawned;
    expect(room.state.players.get(c.sessionId).role).toBe('cop'); // роль из записи персонажа
  });

  it('deleteChar: персонаж исчезает из charList, ник освобождается', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('owner@t.local', 'doomed', 'citizen');
    const c = await testServer.connectTo(room, OPTS('owner@t.local'));
    const list = onceMessage<{ chars: any[] }>(c, 'charList');
    c.send('deleteChar', { name: 'doomed' });
    expect((await list).chars).toEqual([]);
    expect(room.db.getChar('doomed')).toBeNull();
    expect(room.db.hasPlayer('doomed')).toBe(false);
  });

  it('забаненный ник: selectChar и createChar → banned, спавна нет', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('bad@t.local', 'badguy', 'citizen');
    room.db.ban('badguy', '', 'чит', Date.now() + 60_000, false); // временный
    room.db.ban('permNick', '', 'чит', null, false); // перманент — отдельный код
    const c = await testServer.connectTo(room, OPTS('bad@t.local'));
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('selectChar', { name: 'badguy' });
    expect((await err).code).toBe('banned');
    // createChar по забаненному нику (бан переживает удаление/несоздание):
    const err2 = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'permNick', role: 'citizen' });
    expect((await err2).code).toBe('banned_perm');
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
  });

  it('перезаход: прогресс персонажа на месте (selectChar после leave)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'persist');
    room.state.players.get(c1.sessionId).cash = 4321;
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    const c2 = await joinWithChar(testServer, room, 'persist'); // тот же email → selectChar
    expect(room.state.players.get(c2.sessionId).cash).toBe(4321);
  });
});
```

- [ ] **Step 3: прогнать — падают**

Run: `cd server && npx vitest run test/chars.integration.test.ts`
Expected: FAIL (connectTo с email падает / спавна нет — старый onAuth требует name).

- [ ] **Step 4: `PROTOCOL_VERSION = 6`** — `shared/src/config.ts:2`.

- [ ] **Step 5: чистка `server/src/db.ts`**: удалить `getAuth`, `bindEmail`, `getByEmail`; в `PlayerRecord` убрать поля `secret?` и `email?`; в `load()` убрать клейм секрета (96-99) и `secret` из объекта/INSERT (102-106); убрать `import { randomUUID } from 'node:crypto'` (строка 2). Индекс `idx_players_email` (строка 77) оставить — колонка физически остаётся.

- [ ] **Step 6: `CityRoom.ts` — onAuth** (заменить строки 215-251 целиком):

```ts
// аутентификация: только email + пароль. Неизвестный email = регистрация на месте
// (без подтверждения почты). Ник/токен больше не участвуют (жёсткий срез).
onAuth(_client: Client, options: { email?: string; password?: string; ver?: number }, context?: AuthContext): { email: string; ip: string } {
  // хендшейк версии: присланный, но несовпадающий ver отклоняем
  if (options?.ver !== undefined && options.ver !== PROTOCOL_VERSION) throw new Error('bad_version');
  const email = String(options?.email ?? '').trim().toLowerCase().slice(0, 64);
  if (!email) throw new Error('need_email');
  const password = String(options?.password ?? '').slice(0, 128);
  // IP для антифарм-лимита/IP-бана: Colyseus берёт X-Real-IP/X-Forwarded-For (за nginx), иначе сокет
  const rawIp = context?.ip;
  const ip = Array.isArray(rawIp) ? (rawIp[0] ?? '') : (rawIp ?? '').split(',')[0].trim();
  const ipBan = this.db.getActiveIpBan(ip, Date.now());
  if (ipBan) throw new Error(ipBan.until === null ? 'banned_perm' : 'banned');
  const acc = this.db.getAccount(email);
  if (acc) {
    if (!verifyPassword(password, acc.passhash)) throw new Error('bad_password');
  } else {
    if (password.length < 4) throw new Error('weak_password'); // регистрация — минимум 4
    this.db.createAccount(email, hashPassword(password));
  }
  // один онлайн на аккаунт; замороженный призрак — реконнект владельца, его вытеснит spawnPlayer
  for (const c of this.clients) {
    if ((c.auth as { email?: string } | undefined)?.email === email && !this.runtimes.get(c.sessionId)?.frozen) {
      throw new Error('account_online');
    }
  }
  return { email, ip };
}
```

- [ ] **Step 7: `CityRoom.ts` — onJoin становится лобби** (заменить строки 253-307):

```ts
// лобби: Player НЕ создаётся — клиент получает список персонажей и выбирает/создаёт
onJoin(client: Client): void {
  this.sendCharList(client);
}

private sendCharList(client: Client): void {
  const email = (client.auth as { email: string }).email;
  client.send('charList', { chars: this.db.listChars(email), copFull: this.copCount() >= COP_LIMIT });
}

private copCount(): number {
  let n = 0;
  this.state.players.forEach(pl => { if (pl.role === 'cop') n++; });
  return n;
}

private lobbyError(client: Client, code: string): void {
  client.send('lobbyError', { code });
}
```

- [ ] **Step 8: `CityRoom.ts` — сообщения лобби** — в `onCreate`, после `this.onMessage('ping', ...)` (строка 200) добавить:

```ts
// --- лобби персонажей (только пока у клиента нет Player в state) ---
this.onMessage('createChar', (client, data) => {
  if (this.state.players.get(client.sessionId)) return;
  const auth = client.auth as { email: string };
  const name = String(data?.name ?? '').trim().slice(0, 16);
  const role = String(data?.role ?? '');
  if (!name) return this.lobbyError(client, 'nick_bad');
  if (role !== 'citizen' && role !== 'cop') return this.lobbyError(client, 'role_bad');
  if (this.db.countChars(auth.email) >= CHARACTER_LIMIT) return this.lobbyError(client, 'slots_full');
  const ban = this.db.getActiveBan(name, Date.now()); // бан переживает удаление ника — проверяем и при создании
  if (ban) return this.lobbyError(client, ban.until === null ? 'banned_perm' : 'banned');
  if (this.db.getChar(name) || this.db.hasPlayer(name)) return this.lobbyError(client, 'nick_taken');
  if (role === 'cop' && this.copCount() >= COP_LIMIT) return this.lobbyError(client, 'cop_full');
  this.db.createChar(auth.email, name, role);
  this.spawnPlayer(client, { name, role });
});
this.onMessage('selectChar', (client, data) => {
  if (this.state.players.get(client.sessionId)) return;
  const auth = client.auth as { email: string };
  const name = String(data?.name ?? '').trim().slice(0, 16);
  const char = this.db.getChar(name);
  if (!char || char.email !== auth.email) return this.lobbyError(client, 'not_found');
  const ban = this.db.getActiveBan(name, Date.now());
  if (ban) return this.lobbyError(client, ban.until === null ? 'banned_perm' : 'banned');
  if (char.role === 'cop' && this.copCount() >= COP_LIMIT) return this.lobbyError(client, 'cop_full');
  this.spawnPlayer(client, char);
});
this.onMessage('deleteChar', (client, data) => {
  if (this.state.players.get(client.sessionId)) return;
  const auth = client.auth as { email: string };
  const name = String(data?.name ?? '').trim().slice(0, 16);
  const char = this.db.getChar(name);
  if (!char || char.email !== auth.email) return this.lobbyError(client, 'not_found');
  this.db.deleteChar(name);
  this.sendCharList(client); // свежий список после удаления
});
```

- [ ] **Step 9: `CityRoom.ts` — spawnPlayer** — добавить метод (перед `onLeave`, строка 309). Это нынешнее тело `onJoin` без bindEmail/authToken, роль — из записи персонажа:

```ts
// спавн персонажа: вытеснение призрака того же ника, загрузка прогресса, StateView, runtime
private spawnPlayer(client: Client, char: { name: string; role: string }): void {
  const name = char.name;
  const ghostId = this.findSessionByName(name);
  if (ghostId) this.removePlayer(ghostId, true); // вытеснение своего призрака — не «вышел»
  const role: 'citizen' | 'cop' = char.role === 'cop' ? 'cop' : 'citizen';
  const rec = this.db.load(name);
  const auth = client.auth as { email: string; ip?: string };

  const p = new Player();
  p.name = name;
  p.role = role;
  const door = role === 'cop' ? this.map.policeDoor : this.map.hospitalDoor;
  p.x = door.x + Math.random() * 4 - 2;
  p.z = door.z + Math.random() * 2; // только в сторону от здания, чтобы не заспавнить в коллизии
  p.cash = rec.cash;
  p.safe = rec.safe;
  p.weapon = rec.weapon;
  p.ammo = rec.ammo;
  if (rec.apt) {
    const apt = this.state.apartments.get(rec.apt);
    if (apt && (!apt.rentedBy || apt.rentedBy === name)) {
      apt.rentedBy = name;
      p.apt = rec.apt;
    }
  }
  this.state.players.set(client.sessionId, p);

  // приватные поля (@view) видит только владелец
  client.view = new StateView();
  client.view.add(p);

  const rt = makeRuntime(Date.now());
  rt.kills = rec.kills;
  rt.deaths = rec.deaths;
  rt.playtimeSec = this.db.getPlaytime(name); // наигрыш переживает релог
  rt.ip = auth.ip ?? ''; // из onAuth — антифарм-лимит переводов по IP
  rt.nextRentAt = this.db.getRentDue(name) || (Date.now() + RENT_INTERVAL_MS); // рента переживает релог
  rt.salaryAnchorX = p.x; // якорь патруля = точка спавна
  rt.salaryAnchorZ = p.z;
  this.runtimes.set(client.sessionId, rt);
  client.send('spawnOk', { name });
  client.send('smsInbox', { unread: this.db.unreadCount(name) });
  this.broadcast('sys', { code: 'join', name, t: this.state.serverTime }); // системное: вошёл в город
}
```

- [ ] **Step 10: `CityRoom.ts` — onLeave: лобби уходит молча** — в начало `onLeave` (строка 309):

```ts
if (!this.state.players.get(client.sessionId)) return; // лобби-клиент: ни игрока, ни runtime — чистить нечего
```

- [ ] **Step 11: `CityRoom.ts` — гард attack для лобби** — в обработчике `attack` (строка 86) первой строкой:

```ts
if (!this.state.players.get(client.sessionId)) return; // лобби не атакует
```

- [ ] **Step 12: `CityRoom.ts` — импорт** — добавить `CHARACTER_LIMIT` в импорт из `@mmo/shared` (строки 3-8). Также импорт `hashPassword` уже есть (строка 12) — теперь используется в `onAuth`.

- [ ] **Step 13: прогнать новые тесты — зелёные**

Run: `cd server && npx vitest run test/chars.integration.test.ts`
Expected: PASS (10 тестов).

- [ ] **Step 14: механическая миграция старых тестов** — заменить вход ником+ролью на хелпер:

```bash
cd server/test
sed -i -E "s/await testServer\.connectTo\(room, \{ name: '([^']+)', role: '(citizen|cop)' \}\)/await joinWithChar(testServer, room, '\1', '\2')/g" room.integration.test.ts ban.integration.test.ts moderation.integration.test.ts phone.integration.test.ts antifarm.integration.test.ts singleroom.integration.test.ts
```

В каждый из этих файлов добавить импорт: `import { joinWithChar } from './helpers.js';` (и `onceMessage` там, где нужен ниже).

- [ ] **Step 15: ручные правки `room.integration.test.ts`**:
  - Тест «кэш переживает переподключение с тем же ником» (~87-101): убрать захват `authToken`; оба входа — `joinWithChar(testServer, room, 'persist1')` (второй после `c1.leave()` + sleep 200 — хелпер сам сделает selectChar). Assert `cash === 1234` без изменений.
  - Тест «auth: чужой под тем же ником без токена…» (~309-324): **удалить** (концепция мертва; занятость ника покрыта в chars.integration `nick_taken`).
  - Тест «рента переживает релог» (~326-339): убрать токен; входы через `joinWithChar(testServer, room, 'tenant')`.
  - Тест «версия протокола» (~341-347): негатив — `testServer.connectTo(room, { email: 'verbad@t.local', password: 'pw1234', ver: 999 })` rejects; позитив — `joinWithChar(testServer, room, 'vergood')`.
  - Тест «дубль активного ника» (~349-357): переименовать в «второй одновременный вход аккаунта отклоняется (account_online)»; после `joinWithChar(testServer, room, 'dup')` — `await expect(testServer.connectTo(room, { email: 'dup@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })).rejects.toThrow(/account_online/)`.
  - Тест «призрак замораживается» (~359+): первый вход через `joinWithChar(testServer, room, 'ghost1')`, остальное без изменений.

- [ ] **Step 16: ручные правки `ban.integration.test.ts`** (ник-бан теперь ловится в лобби, не в onAuth):
  - Тесты ник-бана (~26-28, 35): новый поток — `const c = await testServer.connectTo(room, { email: 'x@t.local', password: 'pw1234', ver: PROTOCOL_VERSION });` → `const err = onceMessage(c, 'lobbyError'); c.send('createChar', { name: 'badguy', role: 'citizen' }); expect((await err).code).toMatch(/banned/);` и `expect(room.state.players.get(c.sessionId)).toBeUndefined()`. После `unban` — `createChar` спавнит (`onceMessage(c, 'spawnOk')`). Истёкший бан — спавнит сразу.
  - IP-бан тесты (~42-56): механика прежняя (connectTo отклоняется), но options обязаны содержать email+password (пустой email → `need_email` сработает раньше бана): `testServer.connectTo(room, { email: 'probe@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })`. Assert `rejects.toThrow(/banned/)` без изменений.

- [ ] **Step 17: ручные правки `phone.integration.test.ts` (~56) и `antifarm.integration.test.ts` (~52, 58)**: убрать захват `authToken`; повторный вход — `joinWithChar` тем же ником после `leave()` + sleep 200 (хелпер сам пошлёт selectChar, прогресс поднимется из БД).

- [ ] **Step 18: `singleroom.integration.test.ts`** (~44-46): full1/full2 — через хелпер (sed уже покрыл); третий — `await expect(testServer.connectTo(room, { email: 'full3@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })).rejects.toThrow();` (переполнение). Проверить, что импорт `PROTOCOL_VERSION` есть в файле — если нет, добавить из `@mmo/shared`.

- [ ] **Step 19: удалить `server/test/email.integration.test.ts`** — замещён chars.integration. `git rm server/test/email.integration.test.ts`.

- [ ] **Step 20: `server/test/db.test.ts`** — удалить тесты «auth: новый аккаунт получает секрет…» (~127-135) и «email: bindEmail/getByEmail…» (~137-144); в тесте со строкой ~21 убрать assert `rec.secret` (секрета больше нет).

- [ ] **Step 21: `server/loadtest/bots.ts`**:
  - Импорт: `import { PROTOCOL_VERSION } from '@mmo/shared';`
  - SILENCED: заменить `'authToken'` на `'charList', 'lobbyError', 'spawnOk'`.
  - Джойн (строка 59): `const room: Room = await client.joinOrCreate('city', { email: \`bot${i}@load.test\`, password: 'botpw1234', ver: PROTOCOL_VERSION });` и сразу после подписок SILENCED: `room.send('createChar', { name: \`bot${i}\`, role });`

- [ ] **Step 22: полный прогон**

Run: `npm test` из корня — зелёно (shared + server). `npm run typecheck` из корня — сервер/shared чисто (клиент ещё старый, его чинит Task 3; если корневой typecheck включает клиентскую сборку — прогнать `tsc --noEmit -p shared && tsc --noEmit -p server`).
Expected: все тесты PASS.

- [ ] **Step 23: Commit**

```bash
git add shared/src/config.ts server/src/db.ts server/src/rooms/CityRoom.ts server/test server/loadtest/bots.ts
git commit -m "feat(server): обязательная email-регистрация, лобби и до 8 персонажей на аккаунт (PROTOCOL_VERSION=6)"
```

---

### Task 3: Клиент — вход по email, экран выбора персонажа

Тестовой инфраструктуры у клиента нет — верификация: `npm run build -w client` (tsc + vite). Ручная проверка — Task 4.

**Files:**
- Modify: `client/index.html:10-24`
- Modify: `client/src/style.css:5-13`
- Modify: `client/src/net.ts:10-22`
- Modify: `client/src/main.ts`
- Modify: `client/src/settings.ts:36-39`
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts`

**Interfaces:**
- Consumes: протокол из Task 2 (`charList`/`lobbyError`/`spawnOk`, `createChar`/`selectChar`/`deleteChar`, join-options `{email,password,ver}`), `CHARACTER_LIMIT` из `@mmo/shared`.
- Produces: localStorage `lastEmail` (предзаполнение). `tok:*` больше не пишется нигде.

- [ ] **Step 1: `client/index.html`** — заменить блок `#join` (строки 10-24):

```html
<div id="join">
  <h1>MMO City</h1>
  <input id="emailInput" type="email" maxlength="64" data-i18n-ph="join.emailPh" />
  <input id="passInput" type="password" data-i18n-ph="join.passPh" />
  <div class="roles">
    <button id="joinGo" data-i18n="join.go"></button>
  </div>
  <div class="roles">
    <button id="langRu">RU</button>
    <button id="langEn">EN</button>
  </div>
  <div id="joinError"></div>
</div>

<div id="chars" class="hidden">
  <h1 data-i18n="chars.title"></h1>
  <div id="charList"></div>
  <div id="charCreate">
    <input id="newCharName" maxlength="16" data-i18n-ph="chars.namePh" />
    <div class="roles">
      <button id="createCitizen" data-i18n="join.citizen"></button>
      <button id="createCop" data-i18n="join.cop"></button>
    </div>
  </div>
  <div id="charsNote"></div>
  <div id="charsError"></div>
</div>
```

- [ ] **Step 2: `client/src/style.css`** — селектор `#join` (строка 5) → `#join, #chars`; правило `#nameInput` (строка 10) → `#emailInput, #passInput, #newCharName { padding: 10px; font-size: 18px; }`; `#joinError` (строка 13) → `#joinError, #charsError { color: #ff6666; }`. Добавить:

```css
#charList { display: flex; flex-direction: column; gap: 8px; }
.charCard { display: flex; gap: 10px; align-items: center; }
.charCard span { min-width: 220px; }
#charCreate { display: flex; flex-direction: column; gap: 12px; align-items: center; }
#charsNote { color: #aaa; font-size: 14px; min-height: 18px; }
button:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 3: `client/src/net.ts`** — заменить `connect` (строки 10-22):

```ts
export async function connect(email: string, password: string): Promise<Room> {
  const client = new Client(serverUrl());
  return client.join('city', { email, password, ver: PROTOCOL_VERSION }); // join-only: комнату создаёт сервер
}
```

(`tok:`-localStorage и обработчик `authToken` удаляются; `reconnect` не трогаем.)

- [ ] **Step 4: `client/src/main.ts` — вход** — заменить строки 24-28 (refs) и 35-80 (`start`):

```ts
const joinScreen = document.getElementById('join')!;
const emailInput = document.getElementById('emailInput') as HTMLInputElement;
const passInput = document.getElementById('passInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;
const charsScreen = document.getElementById('chars')!;
const charListEl = document.getElementById('charList')!;
const charCreateEl = document.getElementById('charCreate')!;
const newCharName = document.getElementById('newCharName') as HTMLInputElement;
const charsNote = document.getElementById('charsNote')!;
const charsError = document.getElementById('charsError')!;

emailInput.value = localStorage.getItem('lastEmail') ?? ''; // предзаполнение — пароль не храним
```

```ts
async function start(): Promise<void> {
  const email = emailInput.value.trim();
  const password = passInput.value; // без trim: пробелы в пароле значимы
  if (!email) {
    joinError.textContent = t('join.needEmail');
    return;
  }
  if (connecting) return;
  connecting = true;
  let room: Room;
  try {
    room = await connect(email, password);
  } catch (e: any) {
    connecting = false;
    const msg = String(e?.message ?? '');
    joinError.textContent = msg.includes('bad_password')
      ? t('join.badPassword')
      : msg.includes('weak_password')
      ? t('join.weakPassword')
      : msg.includes('bad_version')
      ? t('join.badVersion')
      : msg.includes('account_online')
      ? t('join.accountOnline')
      : msg.includes('banned')
      ? t('join.banned')
      : t('join.full');
    return;
  }
  localStorage.setItem('lastEmail', email);
  joinScreen.style.display = 'none';
  enterLobby(room);
}
```

- [ ] **Step 5: `client/src/main.ts` — лобби** — добавить после `start` (перед `waitLiveState`):

```ts
interface CharListMsg { chars: { name: string; role: string }[]; copFull: boolean }

// лобби: комната есть, игрока ещё нет — выбор/создание/удаление персонажа
function enterLobby(room: Room): void {
  let spawned = false;
  charsScreen.classList.remove('hidden');
  charsError.textContent = '';

  room.onMessage('charList', (m: CharListMsg) => renderChars(room, m));
  room.onMessage('lobbyError', (m: { code?: string }) => {
    charsError.textContent = t(`chars.err.${m?.code ?? 'generic'}`);
  });
  room.onMessage('spawnOk', () => {
    spawned = true;
    charsScreen.classList.add('hidden');
    void onSpawned(room);
  });
  room.onLeave(() => {
    if (spawned) return; // игровой реконнект разбирает bootGame
    charsScreen.classList.add('hidden');
    joinScreen.style.display = '';
    joinError.textContent = t('join.full');
    connecting = false;
  });
  document.getElementById('createCitizen')!.addEventListener('click', () => sendCreate(room, 'citizen'));
  document.getElementById('createCop')!.addEventListener('click', () => sendCreate(room, 'cop'));
}

function sendCreate(room: Room, role: string): void {
  const name = newCharName.value.trim();
  if (!name) {
    charsError.textContent = t('chars.err.nick_bad');
    return;
  }
  charsError.textContent = '';
  room.send('createChar', { name, role });
}

function renderChars(room: Room, m: CharListMsg): void {
  charListEl.innerHTML = '';
  for (const ch of m.chars) {
    const card = document.createElement('div');
    card.className = 'charCard';
    const label = document.createElement('span');
    label.textContent = `${ch.name} — ${t(`role.${ch.role}`)}`;
    const play = document.createElement('button');
    play.textContent = t('chars.play');
    play.addEventListener('click', () => { charsError.textContent = ''; room.send('selectChar', { name: ch.name }); });
    const del = document.createElement('button');
    del.textContent = t('chars.delete');
    del.addEventListener('click', () => {
      if (confirm(t('chars.deleteConfirm', { name: ch.name }))) {
        charsError.textContent = '';
        room.send('deleteChar', { name: ch.name });
      }
    });
    card.append(label, play, del);
    charListEl.appendChild(card);
  }
  const full = m.chars.length >= CHARACTER_LIMIT;
  charCreateEl.style.display = full ? 'none' : '';
  (document.getElementById('createCop') as HTMLButtonElement).disabled = m.copFull;
  charsNote.textContent = full ? t('chars.slotsFull') : m.copFull ? t('chars.copFull') : '';
}

async function onSpawned(room: Room): Promise<void> {
  document.getElementById('hud')!.classList.remove('hidden');
  try {
    await Promise.race([
      waitLiveState(room),
      new Promise((_, reject) => setTimeout(() => reject(new Error('state_timeout')), 8000)),
    ]);
  } catch {
    location.reload(); // state не ожил — чистый рестарт на экран входа
    return;
  }
  bootGame(room);
}
```

- [ ] **Step 6: `client/src/main.ts` — хвост** — заменить строки 346-347:

```ts
document.getElementById('joinGo')!.addEventListener('click', () => void start());
passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void start(); });
```

Импорт: добавить `CHARACTER_LIMIT` к импорту из `@mmo/shared` (строка 20: `CAR_MAX_SPEED, dist2`). Удалить неиспользуемый `nameInput`-ref, если остался.

- [ ] **Step 7: `client/src/settings.ts`** — logout (строки 36-39):

```ts
document.getElementById('setLogout')!.addEventListener('click', () => {
  localStorage.removeItem('lastEmail'); // предзаполнение email
  for (const k of Object.keys(localStorage).filter(k => k.startsWith('tok:'))) localStorage.removeItem(k); // legacy-клеймы ников
  location.reload();
});
```

- [ ] **Step 8: i18n** — `client/src/i18n/ru.ts`:
  - Удалить ключи `join.nickPh`, `join.needName`, `join.badToken`.
  - `join.emailPh`: `'Email'`; `join.passPh`: `'Пароль'`.
  - Добавить:

```ts
  'join.go': 'Играть',
  'join.needEmail': 'Введи email',
  'join.accountOnline': 'Этот аккаунт уже в игре',
  'chars.title': 'Выбор персонажа',
  'chars.namePh': 'Ник нового персонажа',
  'chars.play': 'Играть',
  'chars.delete': 'Удалить',
  'chars.deleteConfirm': 'Удалить {name}? Прогресс будет потерян навсегда.',
  'chars.copFull': 'Полиция укомплектована — доступен гражданин',
  'chars.slotsFull': 'Все слоты заняты (8/8)',
  'chars.err.nick_bad': 'Ник от 1 до 16 символов',
  'chars.err.nick_taken': 'Этот ник уже занят',
  'chars.err.role_bad': 'Некорректная роль',
  'chars.err.slots_full': 'Все слоты заняты (8/8)',
  'chars.err.cop_full': 'Полиция укомплектована — доступен гражданин',
  'chars.err.not_found': 'Персонаж не найден',
  'chars.err.banned': 'Персонаж заблокирован',
  'chars.err.banned_perm': 'Персонаж заблокирован навсегда',
  'chars.err.generic': 'Ошибка — попробуй ещё раз',
```

  - `client/src/i18n/en.ts` — **удалить те же три ключа** (`join.nickPh`, `join.needName`, `join.badToken`) и добавить те же новые зеркально (тип `Record<keyof typeof ru, string>` заставит держать ключи в точности): `'Email'`, `'Password'`, `'Play'`, `'Enter email'`, `'Account already in game'`, `'Choose character'`, `'New character nick'`, `'Delete'`, `'Delete {name}? Progress is lost forever.'`, `'Police force is full — citizen available'`, `'All slots taken (8/8)'`, `'Nick must be 1-16 chars'`, `'This nick is taken'`, `'Invalid role'`, `'Character not found'`, `'Character banned'`, `'Character banned permanently'`, `'Error — try again'`.

- [ ] **Step 9: сборка**

Run: `npm run build -w client`
Expected: чисто (tsc + vite build). Если tsc ругается на неиспользуемые переменные — убрать.

- [ ] **Step 10: Commit**

```bash
git add client/index.html client/src/style.css client/src/net.ts client/src/main.ts client/src/settings.ts client/src/i18n/ru.ts client/src/i18n/en.ts
git commit -m "feat(client): вход по email+пароль, экран выбора персонажа (создание/удаление)"
```

---

### Task 4: README + финальная верификация

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — найти (`grep -n 'ник\|токен\|email' README.md`) и обновить описание входа: регистрация по email+пароль обязательна (без подтверждения), до 8 персонажей на аккаунт (ник+роль, свой прогресс), удаление персонажа необратимо. В ручной чек-лист добавить: регистрация нового аккаунта; создание второго персонажа; перезаход — прогресс на месте; вход с неверным паролем — ошибка; второй одновременный вход — «уже в игре».
- [ ] **Step 2: полная верификация**

Run: `npm test` из корня; `npm run typecheck` из корня.
Expected: всё зелёное.

- [ ] **Step 3: ручной E2E (если просили/есть возможность)**: `npm run dev`, два окна `http://localhost:5173`: регистрация → создание персонажа → спавн; второе окно — другой аккаунт; перезаход → экран персонажей, прогресс на месте; удаление персонажа; `cop_full` не проверяем руками (покрыто тестом).
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — обязательная email-регистрация и персонажи"
```

---

## Примечания

- `.superpowers/sdd/probe-join.mjs` (gitignore-пробник) сломается — при следующем использовании обновить под `{email,password}` + createChar.
- Прод-БД `server/game.db`: при деплое migrate() сам перенесёт email-аккаунты в accounts/characters; аккаунты без email перестанут входить (осознанный жёсткий срез). Клиент и сервер выкатывать вместе (PROTOCOL_VERSION=6).
- Риск: лобби-клиенты занимают место в комнате до выбора персонажа — принято (спека, «Открытые риски»).
