# P0-харденинг перед запуском — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть четыре P0-блокера публичного запуска: TLS/деплой-конфиги, мультиаккаунт-фарм денег, расщепление на вторую комнату, отсутствие модерации.

**Architecture:** Подход A «всё внутри сервера»: новых runtime-зависимостей нет. SQLite (bans/mutes/transfer_log/playtime) через существующий `GameDB`, админ-API на существующем Express, статичная админка без сборки, TLS терминируется nginx'ом (конфиги в `deploy/`).

**Tech Stack:** Colyseus 0.16, Express 4, better-sqlite3, Vitest + @colyseus/testing, Vite/Three.js клиент.

**Spec:** `docs/superpowers/specs/2026-07-24-p0-launch-hardening-design.md`

## Global Constraints

- Node 20 (`.nvmrc`), ESM (`"type": "module"`), TS strict; серверные импорты с суффиксом `.js`.
- Новых зависимостей (dependencies и devDependencies) НЕ добавляем ни в один package.json.
- Комментарии в коде — по-русски, коротко, про «почему» (стиль проекта).
- Тесты: `cd server && npx vitest run test/<file>` для точечных, `npm test` из корня (workspaces) для полного прогона, `npm run typecheck` из корня перед каждым коммитом.
- Colyseus 0.16: `onAuth(client, options, req?: http.IncomingMessage)`, комнатный `db` приватный — в тестах доступ через `(room as any).db`.
- Каждая тестовая комната = своя in-memory БД (`GAME_DB=':memory:'`), тесты независимы.
- Клиентские тексты ошибок — по-русски.

---

### Task 1: Константы, бамп протокола, фильтр мата (shared)

**Files:**
- Modify: `shared/src/config.ts`
- Create: `shared/src/profanity.ts`
- Modify: `shared/src/index.ts` (добавить реэкспорт)
- Test: `shared/test/profanity.test.ts`

**Interfaces:**
- Produces: `TRANSFER_MIN_PLAYTIME_SEC`, `TRANSFER_IP_DAILY_LIMIT`, `AUTOMUTE_VIOLATIONS`, `AUTOMUTE_WINDOW_MS`, `AUTOMUTE_MINUTES` (из `@mmo/shared`); `censor(text: string): string` (из `@mmo/shared`); `PROTOCOL_VERSION = 2`.

- [ ] **Step 1: Падающий тест цензуры**

Создать `shared/test/profanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { censor } from '../src/profanity.js';

describe('censor', () => {
  it('маскирует мат звёздочками, сохраняя длину', () => {
    expect(censor('сука, привет')).toBe('****, привет');
  });
  it('регистронезависим и ловит английский мат', () => {
    expect(censor('FUCK off')).toBe('**** off');
  });
  it('ловит подстроку внутри слова', () => {
    expect(censor('пиздец')).toBe('****ец');
  });
  it('чистый текст не трогает', () => {
    expect(censor('привет, город')).toBe('привет, город');
  });
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает**

Run: `cd shared && npx vitest run test/profanity.test.ts`
Expected: FAIL — `Cannot find module '../src/profanity.js'`.

- [ ] **Step 3: Реализация profanity.ts**

Создать `shared/src/profanity.ts`:

```ts
// Мини-словарь явного мата (RU+EN). Не претендует на полноту — режет грубое.
const WORDS = [
  'блядь', 'блять', 'сука', 'хуй', 'пизд', 'ебал', 'ёб', 'мудак', 'пидор', 'пидар', 'нахуй',
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot',
];
const RE = new RegExp(`(${WORDS.join('|')})`, 'giu');

// заменяет мат на звёздочки той же длины (длина строки сохраняется — важно для лимитов)
export function censor(text: string): string {
  return text.replace(RE, (m) => '*'.repeat(m.length));
}
```

В `shared/src/index.ts` добавить строку реэкспорта рядом с существующими (`export * from './profanity.js';`).

- [ ] **Step 4: Константы и бамп протокола в config.ts**

В `shared/src/config.ts`:
- строку `export const PROTOCOL_VERSION = 1;` заменить на `export const PROTOCOL_VERSION = 2;` (новые сообщения `notice`/ошибки `muted`/`need_playtime`/`ip_limit` — старые клиенты должны уйти на «Обновите страницу»);
- в конец файла добавить:

```ts
// антимультиаккаунт: переводы после 30 мин наигрыша + суточный лимит по IP
export const TRANSFER_MIN_PLAYTIME_SEC = 1800;
export const TRANSFER_IP_DAILY_LIMIT = 1000; // $ с одного IP за 24 ч

// автомут: N срабатываний чат-кулдауна за окно → мут
export const AUTOMUTE_VIOLATIONS = 5;
export const AUTOMUTE_WINDOW_MS = 60_000;
export const AUTOMUTE_MINUTES = 10;
```

- [ ] **Step 5: Прогнать — зелёное**

Run: `cd shared && npx vitest run && npx tsc --noEmit`
Expected: все тесты shared PASS (34 старых + 4 новых), typecheck чистый.

- [ ] **Step 6: Commit**

```bash
git add shared/
git commit -m "feat(shared): константы P0-харденинга, censor-фильтр, PROTOCOL_VERSION=2"
```

---

### Task 2: GameDB — playtime, transfer_log, bans, mutes

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/test/db.test.ts` (добавить describe-блоки)

**Interfaces:**
- Consumes: константы Task 1 не нужны напрямую.
- Produces (все методы на `GameDB`):
  - `getPlaytime(name: string): number`
  - `save(rec: PlayerRecord)` — теперь пишет и `playtime_sec`; `PlayerRecord.playtimeSec?: number`
  - `transfer(from: string, to: string, amount: number, ts: number, ip: string): boolean` — новый 5-й аргумент
  - `ipTransferSum(ip: string, sinceTs: number): number`
  - `ban(name: string, ip: string, reason: string, until: number | null, byIp: boolean): void`
  - `unban(name: string): void`
  - `getActiveBan(name: string, now: number): { reason: string; until: number | null } | null`
  - `getActiveIpBan(ip: string, now: number): { reason: string; until: number | null } | null`
  - `listBans(): { name: string; ip: string; reason: string; until: number | null; byIp: number; created: number }[]`
  - `mute(name: string, until: number, reason: string): void`
  - `unmute(name: string): void`
  - `getActiveMute(name: string, now: number): { until: number; reason: string } | null`
  - `listMutes(now: number): { name: string; until: number; reason: string }[]`

- [ ] **Step 1: Падающие тесты**

В `server/test/db.test.ts` (в конец файла, стиль существующих тестов — `new GameDB(':memory:')`) добавить:

```ts
describe('playtime + transfer_log + модерация', () => {
  it('playtime: по умолчанию 0, save/getPlaytime сохраняют значение', () => {
    const db = new GameDB(':memory:');
    db.load('pt1');
    expect(db.getPlaytime('pt1')).toBe(0);
    const rec = db.load('pt1');
    rec.playtimeSec = 1234;
    db.save(rec);
    expect(db.getPlaytime('pt1')).toBe(1234);
    db.close();
  });

  it('ipTransferSum: суммирует только свежие переводы с этого IP', () => {
    const db = new GameDB(':memory:');
    db.load('a'); db.load('b'); db.load('c');
    const now = Date.now();
    db.transfer('a', 'b', 300, now, '1.1.1.1');
    db.transfer('a', 'b', 200, now - 25 * 3600_000, '1.1.1.1'); // старый — не считается
    db.transfer('a', 'b', 500, now, '2.2.2.2');                  // другой IP — не считается
    expect(db.ipTransferSum('1.1.1.1', now - 24 * 3600_000)).toBe(300);
    expect(db.ipTransferSum('', now - 24 * 3600_000)).toBe(0);   // без IP лимит не считаем
    db.close();
  });

  it('ban: активный по нику, истёкший — нет, unban снимает', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.ban('bad1', '1.2.3.4', 'спам', null, false);
    expect(db.getActiveBan('bad1', now)).toEqual({ reason: 'спам', until: null });
    expect(db.getActiveBan('good1', now)).toBeNull();
    db.ban('temp1', '', 'х', now - 1000, false); // уже истёк
    expect(db.getActiveBan('temp1', now)).toBeNull();
    db.unban('bad1');
    expect(db.getActiveBan('bad1', now)).toBeNull();
    db.close();
  });

  it('getActiveIpBan: только byIp=1 и непустой IP', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.ban('soft', '9.9.9.9', 'x', null, false);  // byIp=0 — по IP не сработает
    db.ban('hard', '1.1.1.1', 'x', null, true);
    expect(db.getActiveIpBan('9.9.9.9', now)).toBeNull();
    expect(db.getActiveIpBan('1.1.1.1', now)).not.toBeNull();
    expect(db.getActiveIpBan('', now)).toBeNull();
    db.close();
  });

  it('mute: активен до until, unmute снимает, listMutes отдаёт активные', () => {
    const db = new GameDB(':memory:');
    const now = Date.now();
    db.mute('m1', now + 60_000, 'флуд');
    expect(db.getActiveMute('m1', now)).toEqual({ until: now + 60_000, reason: 'флуд' });
    expect(db.getActiveMute('m2', now)).toBeNull();
    db.mute('m3', now - 1, 'старый');
    expect(db.getActiveMute('m3', now)).toBeNull();
    expect(db.listMutes(now).map(m => m.name)).toEqual(['m1']);
    db.unmute('m1');
    expect(db.getActiveMute('m1', now)).toBeNull();
    db.close();
  });

  it('listBans отдаёт все баны', () => {
    const db = new GameDB(':memory:');
    db.ban('b1', '', 'r1', null, false);
    db.ban('b2', '1.1.1.1', 'r2', Date.now() + 3600_000, true);
    const rows = db.listBans();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.name === 'b2')).toMatchObject({ ip: '1.1.1.1', byIp: 1 });
    db.close();
  });
});
```

Импорт в начале файла (`GameDB`) уже есть в существующем db.test.ts — проверить, при необходимости оставить как есть.

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/db.test.ts`
Expected: FAIL — методы не существуют / сигнатура transfer.

- [ ] **Step 3: Реализация в db.ts**

3a. В `PlayerRecord` (после `secret?`) добавить поле:

```ts
  playtimeSec?: number; // наигрыш в секундах (колонка playtime_sec); антимультиаккаунт
```

3b. В `this.db.exec(...)` конструктора, после `CREATE TABLE IF NOT EXISTS transfers (...)`, добавить таблицы (внутри того же template literal, перед закрывающей скобкой — дописать `;` после transfers и новые statements):

```sql
      CREATE TABLE IF NOT EXISTS transfer_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_nick TEXT NOT NULL,
        to_nick TEXT NOT NULL,
        amount INTEGER NOT NULL,
        ip TEXT NOT NULL DEFAULT '',
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_transfer_log_ip ON transfer_log(ip, ts);
      CREATE TABLE IF NOT EXISTS bans (
        name TEXT PRIMARY KEY,
        ip TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        until INTEGER,
        byIp INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bans_ip ON bans(ip);
      CREATE TABLE IF NOT EXISTS mutes (
        name TEXT PRIMARY KEY,
        until INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT ''
      )
```

3c. В `migrate()` добавить:

```ts
    if (!has('playtime_sec')) this.db.exec(`ALTER TABLE players ADD COLUMN playtime_sec INTEGER NOT NULL DEFAULT 0`);
```

3d. В `save()` заменить SQL (добавить playtime_sec в INSERT и UPDATE):

```ts
  save(rec: PlayerRecord): void {
    this.db.prepare(`
      INSERT INTO players (name, cash, safe, apt, kills, deaths, weapon, ammo, playtime_sec)
      VALUES (@name, @cash, @safe, @apt, @kills, @deaths, @weapon, @ammo, @playtimeSec)
      ON CONFLICT(name) DO UPDATE SET
        cash = @cash, safe = @safe, apt = @apt, kills = @kills, deaths = @deaths,
        weapon = @weapon, ammo = @ammo, playtime_sec = @playtimeSec
    `).run({ playtimeSec: 0, ...rec });
  }
```

3e. Добавить методы (после `setRentDue`):

```ts
  // наигрыш (сек) — порог для переводов; живёт в рантайме, сюда сбрасывается savePlayer'ом
  getPlaytime(name: string): number {
    const row = this.db.prepare('SELECT playtime_sec AS s FROM players WHERE name = ?').get(name) as { s: number } | undefined;
    return row?.s ?? 0;
  }

  // сумма переводов с IP за окно (суточный антифарм-лимит). Без IP — 0 (лимит не срабатывает)
  ipTransferSum(ip: string, sinceTs: number): number {
    if (!ip) return 0;
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM transfer_log WHERE ip = ? AND ts >= ?',
    ).get(ip, sinceTs) as { s: number };
    return row.s;
  }

  ban(name: string, ip: string, reason: string, until: number | null, byIp: boolean): void {
    this.db.prepare(`
      INSERT INTO bans (name, ip, reason, until, byIp, created) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET ip = excluded.ip, reason = excluded.reason,
        until = excluded.until, byIp = excluded.byIp, created = excluded.created
    `).run(name, ip, reason, until, byIp ? 1 : 0, Date.now());
  }

  unban(name: string): void {
    this.db.prepare('DELETE FROM bans WHERE name = ?').run(name);
  }

  getActiveBan(name: string, now: number): { reason: string; until: number | null } | null {
    const row = this.db.prepare('SELECT reason, until FROM bans WHERE name = ?').get(name) as { reason: string; until: number | null } | undefined;
    if (!row) return null;
    if (row.until !== null && row.until <= now) return null; // истёк
    return { reason: row.reason, until: row.until };
  }

  // жёсткий бан по IP — только строки с byIp=1 (NAT: осознанный opt-in админа)
  getActiveIpBan(ip: string, now: number): { reason: string; until: number | null } | null {
    if (!ip) return null;
    const row = this.db.prepare('SELECT reason, until FROM bans WHERE ip = ? AND byIp = 1').get(ip) as { reason: string; until: number | null } | undefined;
    if (!row) return null;
    if (row.until !== null && row.until <= now) return null;
    return { reason: row.reason, until: row.until };
  }

  listBans(): { name: string; ip: string; reason: string; until: number | null; byIp: number; created: number }[] {
    return this.db.prepare('SELECT name, ip, reason, until, byIp, created FROM bans ORDER BY created DESC').all() as any[];
  }

  mute(name: string, until: number, reason: string): void {
    this.db.prepare(`
      INSERT INTO mutes (name, until, reason) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET until = excluded.until, reason = excluded.reason
    `).run(name, Math.floor(until), reason);
  }

  unmute(name: string): void {
    this.db.prepare('DELETE FROM mutes WHERE name = ?').run(name);
  }

  getActiveMute(name: string, now: number): { until: number; reason: string } | null {
    const row = this.db.prepare('SELECT until, reason FROM mutes WHERE name = ?').get(name) as { until: number; reason: string } | undefined;
    if (!row || row.until <= now) return null;
    return { until: row.until, reason: row.reason };
  }

  listMutes(now: number): { name: string; until: number; reason: string }[] {
    return this.db.prepare('SELECT name, until, reason FROM mutes WHERE until > ? ORDER BY until DESC').all(now) as any[];
  }
```

3f. В `transfer()` добавить 5-й параметр `ip: string` и запись в transfer_log внутри транзакции (после INSERT INTO transfers):

```ts
  transfer(from: string, to: string, amount: number, ts: number, ip: string): boolean {
    const tx = this.db.transaction((): boolean => {
      const r = this.db.prepare('UPDATE players SET cash = cash - ? WHERE name = ? AND cash >= ?').run(amount, from, amount);
      if (r.changes === 0) return false;
      this.db.prepare('UPDATE players SET cash = cash + ? WHERE name = ?').run(amount, to);
      this.db.prepare('INSERT INTO transfers (from_nick, to_nick, amount, ts) VALUES (?, ?, ?, ?)').run(from, to, amount, ts);
      this.db.prepare('INSERT INTO transfer_log (from_nick, to_nick, amount, ip, ts) VALUES (?, ?, ?, ?, ?)').run(from, to, amount, ip, ts);
      return true;
    });
    return tx();
  }
```

- [ ] **Step 4: Прогнать — зелёное + typecheck**

Run: `cd server && npx vitest run test/db.test.ts`
Expected: PASS.
Затем поправить вызов в `server/src/systems/economy.ts` (строка `db.transfer(p.name, toNick, sum, now)`): добавить 5-й аргумент-заглушку `''` → `db.transfer(p.name, toNick, sum, now, '')` (Task 3 заменит её на реальный IP). После этого `npx tsc --noEmit` в `server/` — чисто.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/test/db.test.ts server/src/systems/economy.ts
git commit -m "feat(server): playtime, transfer_log, bans/mutes в GameDB"
```

---

### Task 3: Мультиаккаунт-защита (порог наигрыша + IP-лимит переводов)

**Files:**
- Modify: `server/src/runtime.ts`
- Modify: `server/src/systems/economy.ts`
- Modify: `server/src/rooms/CityRoom.ts`
- Modify: `server/test/phone.integration.test.ts` (4 существующих теста переводов — добавить наигрыш)
- Test: `server/test/antifarm.integration.test.ts` (новый)
- Modify: `client/src/phone.ts` (тексты ошибок)

**Interfaces:**
- Consumes: `TRANSFER_MIN_PLAYTIME_SEC`, `TRANSFER_IP_DAILY_LIMIT` (Task 1); `GameDB.getPlaytime/ipTransferSum/transfer(...,ip)` (Task 2).
- Produces: `Runtime.ip: string`, `Runtime.playtimeSec: number`; `tryTransfer(state, db, playerId, to, amount, now, guard: { playtimeSec: number; ip: string })`; `TransferError` += `'need_playtime' | 'ip_limit'`.

- [ ] **Step 1: Runtime — два поля**

В `server/src/runtime.ts`:
- в интерфейс `Runtime` после `frozen: boolean;` добавить:

```ts
  ip: string;           // IP из onAuth (X-Forwarded-For за nginx) — для антифарм-лимита и банов
  playtimeSec: number;  // наигрыш, персистится в players.playtime_sec
  chatViolations: number[]; // ts срабатываний чат-кулдауна (автомут, Task 6)
```

- в `makeRuntime` после `frozen: false,` добавить:

```ts
    ip: '',
    playtimeSec: 0,
    chatViolations: [],
```

- [ ] **Step 2: economy.ts — guard-параметр**

В `server/src/systems/economy.ts`:
- импорт констант: добавить `TRANSFER_MIN_PLAYTIME_SEC, TRANSFER_IP_DAILY_LIMIT` в существующий импорт из `@mmo/shared`.
- заменить тип ошибки и сигнатуру `tryTransfer`:

```ts
export type TransferError = 'bad_amount' | 'self' | 'no_such_user' | 'no_money' | 'need_playtime' | 'ip_limit';

export function tryTransfer(
  state: GameState,
  db: GameDB,
  playerId: string,
  to: unknown,
  amount: unknown,
  now: number,
  guard: { playtimeSec: number; ip: string }, // антимультиаккаунт: наигрыш отправителя + его IP
): { ok: boolean; error?: TransferError; balance?: number; toNick?: string; amount?: number } {
  const p = state.players.get(playerId);
  if (!p) return { ok: false, error: 'no_money' };
  if (guard.playtimeSec < TRANSFER_MIN_PLAYTIME_SEC) return { ok: false, error: 'need_playtime' };
  const sum = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isInteger(sum) || sum < TRANSFER_MIN || sum > TRANSFER_MAX) return { ok: false, error: 'bad_amount' };
  const toNick = typeof to === 'string' ? to.trim() : '';
  if (!toNick) return { ok: false, error: 'no_such_user' };
  if (toNick === p.name) return { ok: false, error: 'self' };
  if (!db.hasPlayer(toNick)) return { ok: false, error: 'no_such_user' };
  if (p.cash < sum) return { ok: false, error: 'no_money' }; // state авторитетен: БД отстаёт до 5с (savePlayer)
  if (db.ipTransferSum(guard.ip, now - 24 * 3600_000) + sum > TRANSFER_IP_DAILY_LIMIT) return { ok: false, error: 'ip_limit' };
  if (!db.transfer(p.name, toNick, sum, now, guard.ip)) return { ok: false, error: 'no_money' };
  p.cash -= sum;
  state.players.forEach((pl) => { if (pl.name === toNick) pl.cash += sum; });
  return { ok: true, balance: p.cash, toNick, amount: sum };
}
```

(Заглушку `''` из Task 2 Step 4 заменить этим кодом.)

- [ ] **Step 3: Падающий интеграционный тест**

Создать `server/test/antifarm.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('антимультиаккаунт (integration)', () => {
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

  it('перевод без наигрыша 30 мин → need_playtime', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'farm1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'farm2', role: 'citizen' });
    room.state.players.get(c1.sessionId).cash = 500;
    (room as any).savePlayer(c1.sessionId);
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'farm2', amount: 100 });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'need_playtime' });
  });

  it('наигрыш копится тиками и персистится через savePlayer', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'pt1', role: 'citizen' });
    await wait(150); // первый же тик накидывает +60 (lastPlaytimeAt стартует с 0)
    const rt = (room as any).runtimes.get(c1.sessionId);
    expect(rt.playtimeSec).toBeGreaterThanOrEqual(60);
    rt.playtimeSec = 4321;
    (room as any).savePlayer(c1.sessionId);
    expect((room as any).db.getPlaytime('pt1')).toBe(4321);
  });

  it('наигрыш восстанавливается при повторном входе', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'ptAnchor', role: 'citizen' }); // держит комнату
    const c1 = await testServer.connectTo(room, { name: 'pt2', role: 'citizen' });
    let tok = '';
    c1.onMessage('authToken', (m: any) => { tok = m.token; });
    await wait(150);
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 999;
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await wait(200);
    const c2 = await testServer.connectTo(room, { name: 'pt2', role: 'citizen', token: tok });
    expect((room as any).runtimes.get(c2.sessionId).playtimeSec).toBe(999);
  });

  it('суточный IP-лимит: 800+800 с одного IP → второй перевод ip_limit', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'whale1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'whale2', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 5000;
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999;
    (room as any).savePlayer(c1.sessionId);
    const results: any[] = [];
    c1.onMessage('transferResult', (m) => results.push(m));
    c1.send('transfer', { to: 'whale2', amount: 800 });
    await wait(600); // пережать writeRateLimited (500 мс)
    c1.send('transfer', { to: 'whale2', amount: 800 });
    await wait(300);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, error: 'ip_limit' });
  });

  it('записи старше 24 ч не считаются в IP-лимит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'old1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'old2', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 5000;
    const rt = (room as any).runtimes.get(c1.sessionId);
    rt.playtimeSec = 99999;
    (room as any).savePlayer(c1.sessionId);
    // «вчерашний» перевод с того же IP напрямую в лог
    (room as any).db.transfer('old1', 'old2', 999, Date.now() - 25 * 3600_000, rt.ip);
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'old2', amount: 900 });
    await wait(300);
    expect(result).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 4: Прогнать — падает**

Run: `cd server && npx vitest run test/antifarm.integration.test.ts`
Expected: FAIL (need_playtime не приходит / playtimeSec undefined).

- [ ] **Step 5: CityRoom — проводка**

В `server/src/rooms/CityRoom.ts`:

5a. В обработчике `transfer` (строки 149–159) передать guard. Заменить тело обработчика на:

```ts
    this.onMessage('transfer', (client, data) => {
      if (this.writeRateLimited(client.sessionId)) return;
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      this.savePlayer(client.sessionId); // синк БД с авторитетной памятью: иначе db.transfer (WHERE cash>=amount) даёт ложный no_money после свежего заработка
      const res = tryTransfer(this.state, this.db, client.sessionId, data?.to, data?.amount, Date.now(), { playtimeSec: rt.playtimeSec, ip: rt.ip });
      client.send('transferResult', { ok: res.ok, error: res.error, balance: res.balance });
      if (res.ok && res.toNick && res.amount) {
        const from = this.state.players.get(client.sessionId)?.name ?? '';
        const toId = this.findSessionByName(res.toNick);
        if (toId) this.clients.find(c => c.sessionId === toId)?.send('transferIn', { from, amount: res.amount });
      }
    });
```

5b. Накопление наигрыша. Добавить приватное поле после `private lastSaveAt = 0;`:

```ts
  private lastPlaytimeAt = 0; // 0 → первый тик сразу начисляет минуту всем онлайн
```

В `tick(dt)` после строки `tickRent(this.state, this.runtimes, now);` добавить:

```ts
    if (now - this.lastPlaytimeAt > 60_000) { // наигрыш для порога переводов (антимультиаккаунт)
      this.runtimes.forEach((rt) => { rt.playtimeSec += 60; });
      this.lastPlaytimeAt = now;
    }
```

5c. Персистенция. В `savePlayer` в вызов `this.db.save({...})` добавить поле `playtimeSec: rt.playtimeSec` (в конец объекта). В `onJoin` после `rt.deaths = rec.deaths;` добавить:

```ts
    rt.playtimeSec = this.db.getPlaytime(name); // наигрыш переживает релог
```

- [ ] **Step 6: Обновить 4 существующих теста переводов**

В `server/test/phone.integration.test.ts` в каждом из тестов переводов перед `c1.send('transfer', ...)` добавить строку наигрыша (имя ника/переменной отличается — по контексту):

- тест `'transfer: балансы обновляются, получателю transferIn'` (после строки `(room as any).savePlayer(c1.sessionId);`): 
```ts
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999; // обход порога 30 мин (антимультиаккаунт)
```
- тест `'transfer: свежий заработок в памяти не даёт ложный no_money'` — та же строка после `room.state.players.get(c1.sessionId).cash = 900;`
- тест `'transfer: нехватка средств → no_money'` — та же строка после `savePlayer` (иначе придёт need_playtime раньше no_money)
- тест `'transferHistory: свои переводы видны'` — та же строка после `savePlayer`

- [ ] **Step 7: Клиентские тексты ошибок**

В `client/src/phone.ts` найти метод `transferErrorText` (маппит коды ошибок на русские тексты) и добавить два кейса:
- `'need_playtime'` → `'Переводы доступны после 30 минут игры'`
- `'ip_limit'` → `'Дневной лимит переводов с вашего IP исчерпан'`

- [ ] **Step 8: Прогнать — зелёное**

Run: `cd server && npx vitest run test/antifarm.integration.test.ts test/phone.integration.test.ts test/db.test.ts && cd .. && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 9: Commit**

```bash
git add server/src/runtime.ts server/src/systems/economy.ts server/src/rooms/CityRoom.ts server/test/ client/src/phone.ts
git commit -m "feat(server): антимультиаккаунт — порог наигрыша 30 мин + суточный IP-лимит переводов"
```

---

### Task 4: Принудительная одна комната

**Files:**
- Modify: `server/src/rooms/CityRoom.ts`
- Modify: `server/src/index.ts`
- Modify: `client/src/net.ts`
- Modify: `client/src/main.ts`
- Test: `server/test/singleroom.integration.test.ts` (новый)

**Interfaces:**
- Produces: `CityRoom.onCreate(options?: { maxClients?: number })` — опция только для тестов; `autoDispose = false`. Клиент: `client.join('city', ...)`.

- [ ] **Step 1: Падающий тест**

Создать `server/test/singleroom.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('одна комната (integration)', () => {
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

  it('два клиента попадают в одну и ту же комнату', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'sr1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'sr2', role: 'citizen' });
    expect(c1.id).toBe(room.roomId);
    expect(c2.id).toBe(room.roomId);
  });

  it('autoDispose=false: комната переживает полный выход игроков', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'sr3', role: 'citizen' });
    await c1.leave();
    await wait(300);
    // room не выброшен colyseus'ом — хэндл жив, принимает новых игроков:
    const c2 = await testServer.connectTo(room, { name: 'sr4', role: 'citizen' });
    expect(c2.id).toBe(room.roomId); // та же комната, а не новая
    expect(room.state.players.get(c2.sessionId).name).toBe('sr4');
  });

  it('переполнение: maxClients=2, третий клиент отклоняется', async () => {
    const room = await testServer.createRoom<GameState>('city', { maxClients: 2 }) as any;
    await testServer.connectTo(room, { name: 'full1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'full2', role: 'citizen' });
    await expect(testServer.connectTo(room, { name: 'full3', role: 'citizen' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/singleroom.integration.test.ts`
Expected: FAIL — тест 2 (комната dispose-ится, connectTo падает) и тест 3 (maxClients не переопределяется опцией). Если connectTo не уважает maxClients (обходит matchmaking), заменить третий тест на реальный клиент: `import { Client } from 'colyseus.js'; const cli = new Client(\`ws://localhost:\${(testServer as any).port}\`); await expect(cli.joinById(room.roomId, { name: 'full3', role: 'citizen' })).rejects.toThrow();`

- [ ] **Step 3: CityRoom — autoDispose и опции**

В `server/src/rooms/CityRoom.ts`:
- после `maxClients = MAX_PLAYERS;` добавить:

```ts
  autoDispose = false; // единственная комната живёт вечно (создаётся сервером при старте)
```

- сигнатуру `onCreate(): void {` заменить на:

```ts
  onCreate(options?: { maxClients?: number }): void {
    if (options?.maxClients) this.maxClients = options.maxClients; // тесты поднимают комнату с маленьким лимитом
```

(остальное тело onCreate без изменений).

- [ ] **Step 4: index.ts — сервер сам создаёт комнату**

Заменить всё содержимое `server/src/index.ts` на:

```ts
import { matchMaker } from 'colyseus';
import { createGameServer } from './app.js';

const port = Number(process.env.PORT ?? 2567);

createGameServer().listen(port).then(async () => {
  // единственная комната на весь процесс: клиент делает join (не create) → расщепление невозможно
  await matchMaker.createRoom('city', {});
  console.log(`[server] ws://localhost:${port}`);
});
```

- [ ] **Step 5: Клиент — join + wss**

Заменить тело `connect` в `client/src/net.ts`:

```ts
export async function connect(name: string, role: string): Promise<Room> {
  // за https (прод, nginx терминирует TLS) — wss на тот же хост без порта; локально — ws на :2567
  const url = (import.meta as any).env?.VITE_SERVER_URL
    ?? (location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.hostname}:2567`);
  const client = new Client(url);
  const token = localStorage.getItem(`tok:${name}`) ?? ''; // клейм ника из прошлого входа
  const room = await client.join('city', { name, role, token, ver: PROTOCOL_VERSION }); // join-only: комнату создаёт сервер
  room.onMessage('authToken', (m: { token: string }) => {
    if (m?.token) localStorage.setItem(`tok:${name}`, m.token);
  });
  return room;
}
```

- [ ] **Step 6: main.ts — тексты ошибок входа**

В `client/src/main.ts` заменить блок `joinError.textContent = ...` (строки 36–40) на:

```ts
    joinError.textContent = msg.includes('bad_token')
      ? 'Этот ник уже занят другим игроком'
      : msg.includes('bad_version')
      ? 'Обновите страницу (новая версия сервера)'
      : msg.includes('banned')
      ? 'Аккаунт заблокирован'
      : 'Сервер полон (100/100) или недоступен — попробуйте позже';
```

(ветку `banned` использует Task 5; добавляем сразу.)

- [ ] **Step 7: Прогнать — зелёное**

Run: `cd server && npx vitest run test/singleroom.integration.test.ts && cd .. && npm run typecheck && npm test`
Expected: новые тесты PASS; весь сьют зелёный (старые тесты не ломаются — они создают комнаты явно через createRoom).

- [ ] **Step 8: Commit**

```bash
git add server/src/rooms/CityRoom.ts server/src/index.ts server/test/singleroom.integration.test.ts client/src/net.ts client/src/main.ts
git commit -m "feat: одна комната — autoDispose=false, сервер создаёт room, клиент join-only, wss для https"
```

---

### Task 5: onAuth — бан при входе + захват IP

**Files:**
- Modify: `server/src/rooms/CityRoom.ts` (`onAuth`, `onJoin`)
- Test: `server/test/ban.integration.test.ts` (новый)

**Interfaces:**
- Consumes: `GameDB.getActiveBan/getActiveIpBan/ban/unban` (Task 2); `Runtime.ip` (Task 3); клиентский текст `banned` (Task 4 Step 6).
- Produces: `client.auth = { name: string; ip: string }`; ошибки входа `'banned' | 'banned_perm'`.

- [ ] **Step 1: Падающий тест**

Создать `server/test/ban.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('бан при входе (integration)', () => {
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

  it('бан по нику: вход отклоняется, после unban — проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    (room as any).db.ban('badguy', '', 'чит', null, false);
    await expect(testServer.connectTo(room, { name: 'badguy', role: 'citizen' })).rejects.toThrow(/banned/);
    (room as any).db.unban('badguy');
    const ok = await testServer.connectTo(room, { name: 'badguy', role: 'citizen' });
    expect(room.state.players.get(ok.sessionId).name).toBe('badguy');
  });

  it('истёкший бан не блокирует', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    (room as any).db.ban('wasbad', '', 'x', Date.now() - 1000, false);
    const c = await testServer.connectTo(room, { name: 'wasbad', role: 'citizen' });
    expect(room.state.players.has(c.sessionId)).toBe(true);
  });

  it('жёсткий бан по IP (byIp=1) блокирует любой ник с этого IP', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // сначала заходим «зондом» и читаем IP, который реально захватил сервер (127.0.0.1 или ::1)
    const probe = await testServer.connectTo(room, { name: 'probe', role: 'citizen' });
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    expect(ip).toBeTruthy(); // IP захватывается в onAuth
    (room as any).db.ban('cheater', ip, 'мультиакк', null, true);
    await expect(testServer.connectTo(room, { name: 'innocent', role: 'citizen' })).rejects.toThrow(/banned/);
  });

  it('мягкий бан (byIp=0) по IP не блокирует другие ники', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const probe = await testServer.connectTo(room, { name: 'probe2', role: 'citizen' });
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    (room as any).db.ban('onlynick', ip, 'x', null, false); // бан ника, не IP
    const other = await testServer.connectTo(room, { name: 'otherguy', role: 'citizen' });
    expect(room.state.players.has(other.sessionId)).toBe(true);
    await expect(testServer.connectTo(room, { name: 'onlynick', role: 'citizen' })).rejects.toThrow(/banned/);
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/ban.integration.test.ts`
Expected: FAIL — вход не блокируется / `ip` пустой.

- [ ] **Step 3: onAuth + onJoin**

В `server/src/rooms/CityRoom.ts` заменить метод `onAuth` целиком:

```ts
  // аутентификация: ник + секрет-токен. Существующий заклеймённый ник требует верный token.
  onAuth(_client: Client, options: { name?: string; token?: string; ver?: number }, req?: import('node:http').IncomingMessage): { name: string; ip: string } {
    // хендшейк версии: присланный, но несовпадающий ver отклоняем (устаревший клиент после бампа схемы)
    if (options?.ver !== undefined && options.ver !== PROTOCOL_VERSION) throw new Error('bad_version');
    const name = String(options?.name ?? '').slice(0, 16);
    if (!name) throw new Error('need_name');
    // IP за nginx — первый адрес из X-Forwarded-For; напрямую — remoteAddress. Нужен антифарм-лимиту и банам
    const fwd = req?.headers?.['x-forwarded-for'];
    const ip = ((typeof fwd === 'string' && fwd) ? fwd.split(',')[0].trim() : '') || req?.socket?.remoteAddress || '';
    const now = Date.now();
    const ban = this.db.getActiveBan(name, now) ?? this.db.getActiveIpBan(ip, now);
    if (ban) throw new Error(ban.until === null ? 'banned_perm' : 'banned');
    const auth = this.db.getAuth(name);
    if (auth.exists && auth.secret && options?.token !== auth.secret) throw new Error('bad_token');
    // один активный сеанс на ник: онлайн-дубль отклоняем. Замороженный призрак — исключение:
    // это реконнект владельца (токен уже проверен выше), его вытеснит onJoin.
    const existingId = this.findSessionByName(name);
    if (existingId && !this.runtimes.get(existingId)?.frozen) throw new Error('name_online');
    return { name, ip };
  }
```

В `onJoin` после `rt.playtimeSec = this.db.getPlaytime(name);` (Task 3) добавить:

```ts
    rt.ip = (client.auth as { name: string; ip?: string }).ip ?? ''; // захвачен в onAuth
```

(тип распаковки `client.auth` в начале onJoin оставить — `(client.auth as { name: string }).name` работает, поле ip читаем отдельно.)

- [ ] **Step 4: Прогнать — зелёное**

Run: `cd server && npx vitest run test/ban.integration.test.ts && npm test && cd .. && npm run typecheck`
Expected: новые тесты PASS, весь сьют зелёный, typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/CityRoom.ts server/test/ban.integration.test.ts
git commit -m "feat(server): бан при входе (ник + опциональный жёсткий IP), захват IP в onAuth"
```

---

### Task 6: Мут, автомут за спам, цензура в чате и SMS

**Files:**
- Modify: `server/src/systems/chat.ts` (цензура)
- Modify: `server/src/systems/messages.ts` (цензура + мут)
- Modify: `server/src/rooms/CityRoom.ts` (обработчик chat: мут + нарушения кулдауна; `recordChatViolation`)
- Modify: `client/src/main.ts` (обработчик `notice`)
- Modify: `client/src/phone.ts` (текст `muted`)
- Test: `server/test/moderation.integration.test.ts` (новый)

**Interfaces:**
- Consumes: `censor` (Task 1), `AUTOMUTE_*` (Task 1), `GameDB.getActiveMute/mute` (Task 2), `Runtime.chatViolations` (Task 3).
- Produces: серверное сообщение `notice { text: string }` (клиент показывает тостом); `SmsError` += `'muted'`; `CityRoom.recordChatViolation(id: string): void` (private).

- [ ] **Step 1: Падающий тест**

Создать `server/test/moderation.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('модерация: мут/автомут/цензура (integration)', () => {
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

  it('мут блокирует чат: сообщение не рассылается, приходит notice', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'muted1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'listen1', role: 'citizen' });
    (room as any).db.mute('muted1', Date.now() + 60_000, 'тест');
    const got: any[] = [];
    let notice: any = null;
    c1.onMessage('notice', (m) => { notice = m; });
    c1.onMessage('chat', (m) => got.push(m));
    c2.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: 'меня слышно?' });
    await wait(200);
    expect(got).toHaveLength(0);
    expect(notice?.text).toContain('замьючены');
  });

  it('мут блокирует SMS: smsResult error=muted', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'muted2', role: 'citizen' });
    await testServer.connectTo(room, { name: 'smspeer', role: 'citizen' });
    (room as any).db.mute('muted2', Date.now() + 60_000, 'тест');
    let result: any = null;
    c1.onMessage('smsResult', (m) => { result = m; });
    c1.send('sms', { to: 'smspeer', text: 'привет' });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'muted' });
  });

  it('автомут: 5 срабатываний чат-кулдауна за минуту → мут на 10 мин', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'flooder', role: 'citizen' });
    c1.onMessage('chat', () => {}); // гасим warning
    for (let i = 0; i < 6; i++) {
      c1.send('chat', { text: `флуд ${i}` }); // первое проходит, 5 следующих — кулдаун
      await wait(30);
    }
    await wait(200);
    const mute = (room as any).db.getActiveMute('flooder', Date.now());
    expect(mute).not.toBeNull();
    expect(mute.reason).toContain('спам');
  });

  it('цензура: мат в чате уходит замаскированным', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'rude1', role: 'citizen' });
    const got: any[] = [];
    c1.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: 'сука, опять лаги' });
    await wait(200);
    expect(got[0].text).toBe('****, опять лаги');
  });

  it('цензура: мат в SMS маскируется до записи в БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'rude2', role: 'citizen' });
    await testServer.connectTo(room, { name: 'rude3', role: 'citizen' });
    c1.onMessage('smsResult', () => {});
    c1.send('sms', { to: 'rude3', text: 'ты мудак' });
    await wait(200);
    const thread = (room as any).db.getThread('rude2', 'rude3', 10);
    expect(thread[0].text).toBe('ты *****');
  });
});
```

- [ ] **Step 2: Прогнать — падает**

Run: `cd server && npx vitest run test/moderation.integration.test.ts`
Expected: FAIL по всем пяти тестам.

- [ ] **Step 3: chat.ts — цензура**

В `server/src/systems/chat.ts`:
- импорт: `import { CHAT_MAX_LEN, CHAT_COOLDOWN_MS, censor } from '@mmo/shared';`
- строку `return { from: p.name, text: trimmed, t: state.serverTime };` заменить на:

```ts
  return { from: p.name, text: censor(trimmed), t: state.serverTime }; // мат — звёздочками
```

- [ ] **Step 4: messages.ts — цензура + мут**

В `server/src/systems/messages.ts`:
- импорт: `import { SMS_MAX_LEN, SMS_COOLDOWN_MS, censor } from '@mmo/shared';`
- тип ошибки: `export type SmsError = 'bad_to' | 'self' | 'bad_text' | 'cooldown' | 'no_such_user' | 'muted';`
- в `trySms` заменить фрагмент от trim текста до `rt.lastSmsAt = now;`:

```ts
  const t = censor(typeof text === 'string' ? text.trim() : ''); // мат — звёздочками до записи в БД
  if (!t || t.length > SMS_MAX_LEN) return { error: 'bad_text' };
  if (now - rt.lastSmsAt < SMS_COOLDOWN_MS) return { error: 'cooldown' };
  if (db.getActiveMute(p.name, now)) return { error: 'muted' };
  if (!db.hasPlayer(toNick)) return { error: 'no_such_user' };
  rt.lastSmsAt = now;
```

- [ ] **Step 5: CityRoom — мут в чате + автомут**

5a. Импорты в начале файла: в импорт из `@mmo/shared` добавить `CHAT_MAX_LEN, CHAT_COOLDOWN_MS, AUTOMUTE_VIOLATIONS, AUTOMUTE_WINDOW_MS, AUTOMUTE_MINUTES`.

5b. Заменить обработчик `chat` (строки 100–106):

```ts
    this.onMessage('chat', (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const rt = this.runtimes.get(client.sessionId);
      if (!p || !rt) return;
      const now = Date.now();
      const mute = this.db.getActiveMute(p.name, now);
      if (mute) {
        client.send('notice', { text: `Вы замьючены до ${new Date(mute.until).toLocaleTimeString('ru-RU')}` });
        return;
      }
      // засчитываем нарушение кулдауна до вызова tryChat (он молча гасит спам)
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      if (text && text.length <= CHAT_MAX_LEN && now - rt.lastChatAt < CHAT_COOLDOWN_MS) {
        this.recordChatViolation(client.sessionId);
      }
      const msg = tryChat(this.state, this.runtimes, client.sessionId, data?.text, now);
      if (!msg) return;
      this.chatLog.push(msg);
      if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift();
      this.broadcast('chat', msg);
    });
```

5c. Добавить приватный метод (рядом с `writeRateLimited`):

```ts
  // N срабатываний чат-кулдауна за окно → автомут (спам-флуд)
  private recordChatViolation(id: string): void {
    const rt = this.runtimes.get(id);
    const p = this.state.players.get(id);
    if (!rt || !p) return;
    const now = Date.now();
    rt.chatViolations = rt.chatViolations.filter(t => now - t < AUTOMUTE_WINDOW_MS);
    rt.chatViolations.push(now);
    if (rt.chatViolations.length >= AUTOMUTE_VIOLATIONS) {
      rt.chatViolations = [];
      this.db.mute(p.name, now + AUTOMUTE_MINUTES * 60_000, 'автомут: спам');
    }
  }
```

- [ ] **Step 6: Клиент — notice и текст muted**

6a. В `client/src/main.ts` в `bootGame(room)` после строки `const phone = new Phone(room, input, (t) => ui.showToast(t), () => avatars.serverNow());` добавить:

```ts
  room.onMessage('notice', (m: { text?: string }) => { if (m?.text) ui.showToast(String(m.text)); }); // мут и прочие серверные уведомления
```

6b. В `client/src/phone.ts` в метод `smsErrorText` добавить кейс `'muted'` → `'Вы замьючены'`.

- [ ] **Step 7: Прогнать — зелёное**

Run: `cd server && npx vitest run test/moderation.integration.test.ts && npm test && cd .. && npm run typecheck`
Expected: все PASS, typecheck чистый.

- [ ] **Step 8: Commit**

```bash
git add server/src/systems/chat.ts server/src/systems/messages.ts server/src/rooms/CityRoom.ts server/test/moderation.integration.test.ts client/src/main.ts client/src/phone.ts
git commit -m "feat: мут (chat+sms), автомут за спам, цензура мата, notice на клиенте"
```

---

### Task 7: Админ API, healthz, реестр комнаты

**Files:**
- Create: `server/src/admin/registry.ts`
- Create: `server/src/admin/routes.ts`
- Modify: `server/src/rooms/CityRoom.ts` (регистрация + admin-методы)
- Modify: `server/src/app.ts`
- Test: `server/test/admin.test.ts` (новый)

**Interfaces:**
- Consumes: `GameDB.ban/unban/mute/unmute/listBans/listMutes` (Task 2), `findSessionByName` (существующий в CityRoom).
- Produces:
  - `registerRoom(r: CityRoom): void`, `getRoom(): CityRoom | null`, `clearRoom(): void` (`admin/registry.ts`)
  - `CityRoom.gameDb: GameDB` (геттер), `CityRoom.adminState()`, `CityRoom.kickByName(name: string): boolean`
  - HTTP `/admin/api/*` (Bearer `ADMIN_TOKEN`), `/healthz`

- [ ] **Step 1: registry.ts**

Создать `server/src/admin/registry.ts`:

```ts
import type { CityRoom } from '../rooms/CityRoom.js';

// синглтон-комната регистрируется в onCreate — админ-API и /healthz ходят через неё
let room: CityRoom | null = null;

export function registerRoom(r: CityRoom): void { room = r; }
export function getRoom(): CityRoom | null { return room; }
export function clearRoom(): void { room = null; }
```

- [ ] **Step 2: CityRoom — регистрация и admin-методы**

В `server/src/rooms/CityRoom.ts`:
- импорт: `import { registerRoom, clearRoom } from '../admin/registry.js';`
- в `onCreate` после `if (options?.maxClients) ...` добавить: `registerRoom(this); // админ-API и /healthz`
- в `onDispose` после `this.db.close();` добавить: `clearRoom();`
- добавить публичные члены (после метода `findSessionByName`):

```ts
  // --- админ-API (server/src/admin/routes.ts) ---
  get gameDb(): GameDB { return this.db; }

  adminState(): {
    players: { name: string; cash: number; wanted: boolean; playtimeSec: number; ip: string }[];
    playersOnline: number; maxClients: number; uptimeSec: number;
  } {
    const players: { name: string; cash: number; wanted: boolean; playtimeSec: number; ip: string }[] = [];
    this.state.players.forEach((p, id) => {
      if (p.role === 'zombie') return;
      const rt = this.runtimes.get(id);
      players.push({
        name: p.name,
        cash: p.cash,
        wanted: p.wantedUntil > Date.now(),
        playtimeSec: rt?.playtimeSec ?? 0,
        ip: rt?.ip ?? '',
      });
    });
    return { players, playersOnline: players.length, maxClients: this.maxClients, uptimeSec: Math.floor(process.uptime()) };
  }

  kickByName(name: string): boolean {
    const id = this.findSessionByName(name);
    if (!id) return false;
    this.clients.find(c => c.sessionId === id)?.leave(4000); // 4000 = consented, без окна реконнекта
    return true;
  }
```

- [ ] **Step 3: routes.ts**

Создать `server/src/admin/routes.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getRoom } from './registry.js';

// Bearer ADMIN_TOKEN из env; без env — всё 503 (fail-closed), с неверным — 401
function auth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) { res.status(503).json({ error: 'admin_disabled' }); return; }
  if (req.headers.authorization !== `Bearer ${token}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  next();
}

const nick = (v: unknown): string => String(v ?? '').slice(0, 16);

export function adminApi(): Router {
  const r = Router();
  r.use(auth);

  r.get('/state', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json(room.adminState());
  });

  r.post('/kick', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    if (!room.kickByName(nick(req.body?.name))) { res.status(404).json({ error: 'not_online' }); return; }
    res.json({ ok: true });
  });

  r.post('/ban', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    const name = nick(req.body?.name);
    if (!name) { res.status(400).json({ error: 'need_name' }); return; }
    const hours = Number(req.body?.hours ?? 0);
    const until = hours > 0 ? Date.now() + hours * 3600_000 : null; // 0/отсутствует = перманент
    const reason = String(req.body?.reason ?? '').slice(0, 120);
    const online = room.adminState().players.find(pl => pl.name === name);
    room.gameDb.ban(name, online?.ip ?? '', reason, until, req.body?.byIp === true);
    if (online) room.kickByName(name); // бан вышвыривает сразу
    res.json({ ok: true });
  });

  r.post('/unban', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    room.gameDb.unban(nick(req.body?.name));
    res.json({ ok: true });
  });

  r.post('/mute', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    const name = nick(req.body?.name);
    const minutes = Number(req.body?.minutes ?? 0);
    if (!name || !(minutes > 0)) { res.status(400).json({ error: 'need_name_minutes' }); return; }
    room.gameDb.mute(name, Date.now() + minutes * 60_000, String(req.body?.reason ?? '').slice(0, 120));
    res.json({ ok: true });
  });

  r.post('/unmute', (req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    room.gameDb.unmute(nick(req.body?.name));
    res.json({ ok: true });
  });

  r.get('/bans', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json({ items: room.gameDb.listBans() });
  });

  r.get('/mutes', (_req, res) => {
    const room = getRoom();
    if (!room) { res.status(503).json({ error: 'no_room' }); return; }
    res.json({ items: room.gameDb.listMutes(Date.now()) });
  });

  return r;
}
```

- [ ] **Step 4: app.ts — express-приложение с /healthz и /admin**

Заменить всё содержимое `server/src/app.ts` на:

```ts
import { Server } from 'colyseus';
import { createServer } from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityRoom } from './rooms/CityRoom.js';
import { adminApi } from './admin/routes.js';
import { getRoom } from './admin/registry.js';

const dirname = path.dirname(fileURLToPath(import.meta.url)); // ESM: __dirname нет

export function createExpressApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.get('/', (_req, res) => res.send('mmo2game server'));
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', players: getRoom()?.adminState().playersOnline ?? 0, uptimeSec: Math.floor(process.uptime()) });
  });
  app.use('/admin/api', adminApi());
  app.use('/admin', express.static(path.join(dirname, '../public'))); // dev-раздача админки; в prod — nginx
  return app;
}

export function createGameServer(): Server {
  const gameServer = new Server({ server: createServer(createExpressApp()) });
  gameServer.define('city', CityRoom);
  return gameServer;
}
```

- [ ] **Step 5: Падающий тест API**

Создать `server/test/admin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { createExpressApp } from '../src/app.js';
import { registerRoom, clearRoom } from '../src/admin/registry.js';
import { GameDB } from '../src/db.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('админ API', () => {
  let srv: HttpServer;
  let base: string;
  let db: GameDB;

  const stubRoom = () => ({
    adminState: () => ({
      players: [{ name: 'online1', cash: 100, wanted: false, playtimeSec: 60, ip: '5.5.5.5' }],
      playersOnline: 1, maxClients: 100, uptimeSec: 1,
    }),
    kickByName: (n: string) => n === 'online1',
    gameDb: db,
  });

  beforeAll(async () => {
    process.env.ADMIN_TOKEN = 'test-token';
    srv = createExpressApp().listen(0);
    await new Promise<void>(r => srv.once('listening', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.ADMIN_TOKEN;
    await new Promise(r => srv.close(r));
  });

  beforeEach(() => {
    db = new GameDB(':memory:');
    registerRoom(stubRoom() as any);
  });

  const api = (path: string, opts: RequestInit = {}, token: string | null = 'test-token') =>
    fetch(`${base}/admin/api${path}`, {
      ...opts,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });

  it('/healthz отвечает JSON без авторизации', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.players).toBe(1); // stubRoom зарегистрирован в beforeEach
  });

  it('без токена — 401, с неверным — 401', async () => {
    expect((await api('/state', {}, null)).status).toBe(401);
    expect((await api('/state', {}, 'wrong')).status).toBe(401);
  });

  it('без ADMIN_TOKEN в env — 503 (fail-closed)', async () => {
    const saved = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    expect((await api('/state')).status).toBe(503);
    process.env.ADMIN_TOKEN = saved;
  });

  it('/state отдаёт игроков комнаты', async () => {
    const res = await api('/state');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playersOnline).toBe(1);
    expect(body.players[0]).toMatchObject({ name: 'online1', ip: '5.5.5.5' });
  });

  it('/kick: онлайн — ok, офлайн — 404', async () => {
    const ok = await api('/kick', { method: 'POST', body: JSON.stringify({ name: 'online1' }) });
    expect(ok.status).toBe(200);
    const no = await api('/kick', { method: 'POST', body: JSON.stringify({ name: 'ghost' }) });
    expect(no.status).toBe(404);
  });

  it('/ban пишет в БД (IP подхватывается из онлайна), /unban снимает', async () => {
    const res = await api('/ban', { method: 'POST', body: JSON.stringify({ name: 'online1', reason: 'чит', byIp: true }) });
    expect(res.status).toBe(200);
    expect(db.getActiveBan('online1', Date.now())).toEqual({ reason: 'чит', until: null });
    expect(db.getActiveIpBan('5.5.5.5', Date.now())).not.toBeNull();
    await api('/unban', { method: 'POST', body: JSON.stringify({ name: 'online1' }) });
    expect(db.getActiveBan('online1', Date.now())).toBeNull();
  });

  it('/mute требует минуты, /mutes отдаёт активные', async () => {
    expect((await api('/mute', { method: 'POST', body: JSON.stringify({ name: 'm1' }) })).status).toBe(400);
    const res = await api('/mute', { method: 'POST', body: JSON.stringify({ name: 'm1', minutes: 30, reason: 'флуд' }) });
    expect(res.status).toBe(200);
    const list = await (await api('/mutes')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'm1', reason: 'флуд' });
    await api('/unmute', { method: 'POST', body: JSON.stringify({ name: 'm1' }) });
    expect(db.getActiveMute('m1', Date.now())).toBeNull();
  });

  it('/bans отдаёт список', async () => {
    await api('/ban', { method: 'POST', body: JSON.stringify({ name: 'b1', hours: 2 }) });
    const list = await (await api('/bans')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].name).toBe('b1');
    expect(list.items[0].until).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 6: Прогнать — падает, потом зелёное**

Run: `cd server && npx vitest run test/admin.test.ts`
Expected: PASS. (В этой задаче реализация идёт перед тестом — API-роутинг удобнее собрать целиком; тест здесь как регрессионный каркас.) Затем `npm test && cd .. && npm run typecheck` — весь сьют зелёный.

- [ ] **Step 7: Интеграция kick на живой комнате**

В `server/test/room.integration.test.ts` добавить тест (в конец describe):

```ts
  it('kickByName дисконнектит игрока (admin)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await testServer.connectTo(room, { name: 'kickme', role: 'citizen' });
    expect((room as any).kickByName('kickme')).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(room.state.players.has(c.sessionId)).toBe(false);
    expect((room as any).kickByName('nobody')).toBe(false);
  });
```

Run: `cd server && npx vitest run test/room.integration.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/admin/ server/src/app.ts server/src/rooms/CityRoom.ts server/test/admin.test.ts server/test/room.integration.test.ts
git commit -m "feat(server): админ API (state/kick/ban/mute) с Bearer-токеном, /healthz, реестр комнаты"
```

---

### Task 8: Админ-страница (статика без сборки)

**Files:**
- Create: `server/public/index.html`
- Test: `server/test/admin-static.test.ts` (новый)

**Interfaces:**
- Consumes: HTTP API Task 7; статика по `/admin/` (app.ts, Task 7 Step 4).

- [ ] **Step 1: Страница**

Создать `server/public/index.html`:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>MMO Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 14px/1.4 monospace; background: #111; color: #ddd; max-width: 960px; margin: 20px auto; padding: 0 12px; }
  h1 { font-size: 18px; } h2 { font-size: 15px; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #333; padding: 4px 8px; text-align: left; }
  th { background: #1c1c1c; }
  button { background: #2a2a2a; color: #ddd; border: 1px solid #444; padding: 3px 10px; cursor: pointer; margin-right: 4px; }
  button:hover { background: #3a3a3a; }
  input { background: #1c1c1c; color: #ddd; border: 1px solid #444; padding: 5px 8px; }
  #err { color: #f66; min-height: 1.2em; }
  .muted { color: #888; }
</style>
</head>
<body>
<h1>MMO Admin</h1>
<div id="auth">
  Токен: <input id="token" type="password" size="40" placeholder="ADMIN_TOKEN">
  <button onclick="saveToken()">Войти</button>
</div>
<div id="err"></div>
<div id="app" style="display:none">
  <h2>Онлайн <span id="count" class="muted"></span></h2>
  <table id="players">
    <tr><th>Ник</th><th>Кэш</th><th>Розыск</th><th>Наигрыш</th><th>IP</th><th>Действия</th></tr>
  </table>
  <h2>Баны</h2>
  <table id="bans"><tr><th>Ник</th><th>IP</th><th>До</th><th>byIp</th><th>Причина</th><th></th></tr></table>
  <h2>Муты</h2>
  <table id="mutes"><tr><th>Ник</th><th>До</th><th>Причина</th><th></th></tr></table>
</div>
<script>
let token = sessionStorage.getItem('admintoken') || '';
const $ = (id) => document.getElementById(id);
const err = (t) => { $('err').textContent = t || ''; };

async function api(path, opts = {}) {
  const res = await fetch('/admin/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
  });
  if (res.status === 401) { err('Неверный токен'); throw new Error('401'); }
  if (!res.ok) { err('Ошибка ' + res.status); throw new Error(String(res.status)); }
  return res.json();
}

function saveToken() {
  token = $('token').value.trim();
  sessionStorage.setItem('admintoken', token);
  refresh();
}

async function act(path, body) {
  err('');
  await api(path, { method: 'POST', body: JSON.stringify(body) });
  refresh();
}

function kick(name) { if (confirm(`Кикнуть ${name}?`)) act('/kick', { name }); }
function mute(name) {
  const minutes = Number(prompt(`Мут ${name} на сколько минут?`, '30'));
  if (minutes > 0) act('/mute', { name, minutes, reason: prompt('Причина?', '') || '' });
}
function ban(name) {
  const hours = Number(prompt(`Бан ${name}: часов (0 = навсегда)`, '0'));
  if (isNaN(hours) || hours < 0) return;
  const reason = prompt('Причина?', '') || '';
  const byIp = confirm('Жёсткий бан по IP? (затронет всех с этим IP)');
  act('/ban', { name, hours, reason, byIp });
}
function unban(name) { act('/unban', { name }); }
function unmute(name) { act('/unmute', { name }); }

const fmtUntil = (u) => u === null ? 'навсегда' : new Date(u).toLocaleString('ru-RU');
const row = (cells) => '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
const esc = (s) => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])); // кавычки тоже — ники идут в inline-обработчики

async function refresh() {
  err('');
  try {
    const st = await api('/state');
    $('app').style.display = '';
    $('count').textContent = `(${st.playersOnline}/${st.maxClients}, аптайм ${st.uptimeSec}с)`;
    $('players').innerHTML = '<tr><th>Ник</th><th>Кэш</th><th>Розыск</th><th>Наигрыш</th><th>IP</th><th>Действия</th></tr>'
      + st.players.map(p => row([
        esc(p.name), p.cash, p.wanted ? 'да' : '', Math.round(p.playtimeSec / 60) + ' мин', esc(p.ip),
        `<button onclick="kick('${esc(p.name)}')">кик</button><button onclick="mute('${esc(p.name)}')">мут</button><button onclick="ban('${esc(p.name)}')">бан</button>`,
      ])).join('');
    const bans = await api('/bans');
    $('bans').innerHTML = '<tr><th>Ник</th><th>IP</th><th>До</th><th>byIp</th><th>Причина</th><th></th></tr>'
      + bans.items.map(b => row([esc(b.name), esc(b.ip), fmtUntil(b.until), b.byIp ? 'да' : '', esc(b.reason),
        `<button onclick="unban('${esc(b.name)}')">снять</button>`])).join('');
    const mutes = await api('/mutes');
    $('mutes').innerHTML = '<tr><th>Ник</th><th>До</th><th>Причина</th><th></th></tr>'
      + mutes.items.map(m => row([esc(m.name), fmtUntil(m.until), esc(m.reason),
        `<button onclick="unmute('${esc(m.name)}')">снять</button>`])).join('');
  } catch { /* ошибка уже показана в #err */ }
}

if (token) refresh();
setInterval(() => { if (token) refresh(); }, 5000);
</script>
</body>
</html>
```

- [ ] **Step 2: Тест раздачи статики**

Создать `server/test/admin-static.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { createExpressApp } from '../src/app.js';

describe('админка (статика)', () => {
  let srv: HttpServer | null = null;

  afterAll(async () => {
    if (srv) await new Promise(r => srv!.close(r));
  });

  it('GET /admin/ отдаёт страницу', async () => {
    srv = createExpressApp().listen(0);
    await new Promise<void>(r => srv!.once('listening', r));
    const port = (srv.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/admin/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MMO Admin');
  });
});
```

- [ ] **Step 3: Прогнать + ручная проверка**

Run: `cd server && npx vitest run test/admin-static.test.ts && npm test && cd .. && npm run typecheck`
Expected: PASS.
Ручная проверка (dev): `ADMIN_TOKEN=dev123 npm run dev -w server`, открыть `http://localhost:2567/admin/`, ввести токен → список игроков пустой/живой, кнопки работают.

- [ ] **Step 4: Commit**

```bash
git add server/public/index.html server/test/admin-static.test.ts
git commit -m "feat(server): статичная админ-страница /admin (игроки, баны, муты)"
```

---

### Task 9: Deploy-конфиги (nginx, systemd, скрипт, инструкция)

**Files:**
- Create: `deploy/nginx/mmo.conf`
- Create: `deploy/systemd/mmo-server.service`
- Create: `deploy/deploy.sh`
- Create: `deploy/README.md`

**Interfaces:**
- Consumes: `wss://`-поддержка клиента (Task 4 Step 5), `/healthz` и `/admin` (Task 7), `matchMaker.createRoom` при старте (Task 4 Step 4).

- [ ] **Step 1: nginx-конфиг**

Создать `deploy/nginx/mmo.conf`:

```nginx
# MMO City — виртуальный хост. Кладётся в /etc/nginx/sites-available/mmo, symlink в sites-enabled.
# ЗАМЕНИТЬ example.com на свой домен (2 места) до certbot.

# WebSocket-апгрейд: для обычных GET Connection=close, для WS — upgrade
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;

    # Заполняет certbot (sudo certbot --nginx): раскомментировать после первого запуска
    # ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    # include /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /srv/mmo/client/dist;
    index index.html;

    # статика клиента; всё, что не файл (WS на /, POST /matchmake/*), — на игровой сервер
    location / {
        try_files $uri $uri/ @game;
    }

    location @game {
        proxy_pass http://127.0.0.1:2567;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; # IP для антифарма/банов
        proxy_read_timeout 3600s; # не рвать «тихие» WS
    }

    location = /healthz {
        proxy_pass http://127.0.0.1:2567;
    }

    location /admin/api/ {
        proxy_pass http://127.0.0.1:2567;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # админка — статика из репо
    location /admin/ {
        alias /srv/mmo/server/public/;
    }
}
```

- [ ] **Step 2: systemd-unit**

Создать `deploy/systemd/mmo-server.service`:

```ini
[Unit]
Description=MMO City game server
After=network.target

[Service]
Type=simple
User=mmo
WorkingDirectory=/srv/mmo/server
EnvironmentFile=/etc/mmo/env
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Скрипт деплоя**

Создать `deploy/deploy.sh`:

```bash
#!/usr/bin/env bash
# Деплой на VPS: git archive → deps → build клиента → restart. Запуск из корня репо:
#   ./deploy/deploy.sh root@1.2.3.4
# Хост — root (или sudo-пользователь): у сервисного mmo shell nologin, ssh туда не зайти.
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh root@host}"

git archive HEAD | ssh "$HOST" 'mkdir -p /srv/mmo && tar -x -C /srv/mmo'
ssh "$HOST" 'cd /srv/mmo && npm ci && npm run build -w client && chown -R mmo:mmo /srv/mmo && systemctl restart mmo-server'
ssh "$HOST" 'curl -sf http://127.0.0.1:2567/healthz && echo " — deploy OK"'
```

`chmod +x deploy/deploy.sh`.

- [ ] **Step 4: Инструкция**

Создать `deploy/README.md`:

```markdown
# Деплой MMO City на VPS

## Что купить

- VPS: минимум 1 vCPU / 1 GB RAM, Ubuntu 24.04 (нагрузка 100 игроков: ~7% CPU, ~115 MB — замерено loadtest).
- Домен: любой регистратор, A-запись на IP VPS. Без домена TLS не выдать — игра работает только по wss.

## Первичная настройка сервера (один раз)

```bash
# на VPS под root
apt update && apt install -y nginx certbot python3-certbot-nginx ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
useradd -r -m -d /srv/mmo -s /usr/sbin/nologin mmo || true   # сервисный пользователь (без ssh)
mkdir -p /etc/mmo
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable   # 2567 наружу НЕ открываем — только nginx

# env вне репо
cat > /etc/mmo/env <<EOF
PORT=2567
GAME_DB=/srv/mmo/server/game.db
ADMIN_TOKEN=$(openssl rand -hex 32)
EOF
chmod 600 /etc/mmo/env && cat /etc/mmo/env   # сохранить ADMIN_TOKEN себе
```

Первый деплой (из локального корня репо — раскладывает код в /srv/mmo):

```bash
./deploy/deploy.sh root@<IP>   # systemctl restart пока упадёт — юнита ещё нет, это нормально
```

Конфиги и запуск (на VPS под root — файлы уже лежат в /srv/mmo/deploy после деплоя):

```bash
cp /srv/mmo/deploy/nginx/mmo.conf /etc/nginx/sites-available/mmo
# отредактировать: example.com → свой домен (2 места)
ln -s /etc/nginx/sites-available/mmo /etc/nginx/sites-enabled/mmo
cp /srv/mmo/deploy/systemd/mmo-server.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now mmo-server
nginx -t && systemctl reload nginx
```

TLS (после того как A-запись пропагировалась):

```bash
ssh root@<IP> 'certbot --nginx -d <домен>'
# certbot сам правит mmo.conf: раскомментирует ssl_* и добавит редирект
```

Проверка: `https://<домен>/healthz` → `{"status":"ok",...}`; `https://<домен>/admin/` → страница логина админки.

## Каждый следующий деплой

```bash
./deploy/deploy.sh root@<IP>
```

Клиент и сервер версионируются вместе (PROTOCOL_VERSION): деплоим всегда целиком, не по частям.

## Операционка

- Логи: `journalctl -u mmo-server -f`
- БД: `/srv/mmo/server/game.db` (SQLite WAL). Бэкап — бэклог P1; пока: `systemctl stop mmo-server && cp game.db game.db.bak && systemctl start mmo-server`.
- Админка: `https://<домен>/admin/`, токен из `/etc/mmo/env`.
```

- [ ] **Step 5: Проверка**

Автоматических тестов нет (инфра). Проверить глазами: пути `/srv/mmo/...` согласованы между конфигами, `deploy.sh` запускается (`bash -n deploy/deploy.sh` — синтаксис).

Run: `bash -n deploy/deploy.sh && echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add deploy/
git commit -m "feat(deploy): nginx + systemd + скрипт деплоя + инструкция (TLS через certbot)"
```

---

### Task 10: Финальная верификация + README

**Files:**
- Modify: `README.md` (актуализация)

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: Полный прогон**

Run: `npm run typecheck && npm test` (из корня)
Expected: typecheck чистый во всех трёх workspaces; все тесты зелёные (204 старых + новые ~25).

- [ ] **Step 2: Smoke руками (dev)**

```bash
npm run dev -w server &          # в логе: комната создана при старте
npm run dev -w client            # vite
```

Чеклист: вход двумя вкладками → оба в одной комнате; перевод новичком → «Переводы доступны после 30 минут игры»; флуд чатом ×6 → «Вы замьючены»; `http://localhost:2567/healthz` → JSON; `/admin/` с `ADMIN_TOKEN` → игроки видны, кик работает.

- [ ] **Step 3: README**

В `README.md` обновить: количество тестов, упоминание `/admin/` (токен в env `ADMIN_TOKEN`), `deploy/` (прод-запуск), поведение «сервер полон (100)». Убрать устаревшее описание реконнекта, если затронуто (реконнект не менялся — не трогаем).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — админка, деплой, лимит 100 игроков, актуальные числа тестов"
```

---

## Свод покрытия spec → задачи

| Требование spec | Задача |
|---|---|
| TLS/wss клиент + healthz | 4 (net.ts), 7 (healthz) |
| deploy/: nginx/systemd/script/README | 9 |
| playtimeSec + порог 30 мин | 1, 2, 3 |
| transfer_log + IP-лимит $1000/24ч | 1, 2, 3 |
| autoDispose=false, createRoom при старте, join-only, «сервер полон» | 4 |
| bans (ник/IP), mutes, onAuth-принуждение | 2, 5 |
| мут в chat/sms + notice + текст клиента | 6 |
| автомут за спам | 1, 3 (chatViolations), 6 |
| censor в chat/sms | 1, 6 |
| /admin/api/* + Bearer + fail-closed | 7 |
| админ-страница | 8 |
| реестр комнаты (registry) | 7 |
| тексты ошибок клиента (need_playtime/ip_limit/muted/banned/сервер полон) | 3, 4, 6 |
| PROTOCOL_VERSION bump | 1 |
