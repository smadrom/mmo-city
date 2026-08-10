# Обязательная регистрация по email + до 8 персонажей на аккаунт — дизайн

Дата: 2026-08-10. Статус: утверждено в brainstorming-диалоге.

## Цель

1. Регистрация по email становится **обязательной** (без подтверждения почты). Вход по нику+токену (`tok:<ник>` в localStorage) полностью умирает — **жёсткий срез**: аккаунты без привязанного email больше не входят.
2. Один аккаунт (email+пароль) владеет **до 8 персонажей**. Персонаж = ник (глобально уникальный) + закреплённая роль (`citizen|cop`) + собственный прогресс (деньги, квартира, оружие, статистика).
3. Персонажей можно создавать и **удалять** (необратимо, с подтверждением в UI).
4. Поток: логин → **лобби внутри комнаты** (клиент в комнате без `Player` в state) → экран выбора/создания персонажа → спавн.

## Решённые вопросы (из диалога)

- Слот = ник + роль + свой прогресс (как в классических MMO). Внешность/скины **не** вводим.
- Старые аккаунты без email — жёсткий срез, миграции нет. Аккаунты **с** email мигрируют (см. ниже).
- Удаление персонажей — да, с подтверждением.

## 1. Модель данных (БД, `server/src/db.ts`)

Новые таблицы:

```sql
CREATE TABLE IF NOT EXISTS accounts(
  email TEXT PRIMARY KEY,            -- нормализованный lowercase
  passhash TEXT NOT NULL,            -- scrypt salt:hashHex (как сейчас)
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters(
  name TEXT PRIMARY KEY,             -- ник, глобально уникален
  email TEXT NOT NULL REFERENCES accounts(email),
  role TEXT NOT NULL,                -- 'citizen' | 'cop'
  created INTEGER NOT NULL
);
```

- `players` остаётся таблицей прогресса персонажа (PK `name`): cash, safe, apt, kills, deaths, weapon, ammo, rent_due, playtime_sec. Колонки `secret`, `email`, `passhash` больше не читаются и не пишутся (физически остаются — SQLite DROP COLUMN не нужен).
- **Миграция** (в `migrate()`, идемпотентно): для каждой строки `players` с `email != ''` — вставить аккаунт в `accounts` (email, passhash; при конфликте email — пропустить) и персонажа в `characters` (name, email, `role='citizen'`; роль раньше не хранилась). Аккаунты без email не мигрируют и больше не войдут.
- Все внешние ключи домена (sms, transfers, transfer_log, bans, mutes) по-прежнему ссылаются на **ник** — без изменений.
- Константы в `shared/src/config.ts`: `CHARACTER_LIMIT = 8`; `PROTOCOL_VERSION` 5 → **6**.

Новые/изменённые методы `GameDB`:

- `getAccount(email): { email, passhash } | null`
- `createAccount(email, passhash): void`
- `listChars(email): { name, role }[]` (порядок по `created`)
- `countChars(email): number`
- `getChar(name): { name, email, role } | null`
- `createChar(email, name, role): void` — вставка в `characters` + создание строки прогресса через существующий `load(name)` (стартовые 500 cash).
- `deleteChar(name): void` — удалить из `characters`, `players` и SMS персонажа (`sms` where from/to = ник). `transfers`/`transfer_log`/`bans`/`mutes` **не** трогаем (аудит и анти-обход; бан переживает удаление ника осознанно).
- Устаревшие: `getAuth`, `bindEmail`, `getByEmail`, выдача/клейм `secret` в `load()` — удаляются (жёсткий срез).

## 2. Серверный поток (`server/src/rooms/CityRoom.ts`)

### onAuth

`onAuth(client, { email, password, ver })`:

1. `ver !== PROTOCOL_VERSION` → `Error('bad_version')` (как сейчас, мягко к отсутствию `ver`).
2. email нормализуется (trim/toLowerCase/slice 64); пустой → `Error('need_email')`.
3. Аккаунт существует → `verifyPassword`, неверно → `Error('bad_password')`. Не существует → **регистрация на месте**: `password.length < 4` → `Error('weak_password')`, иначе `createAccount` (подтверждения почты нет).
4. Один онлайн на аккаунт: живой не-frozen клиент с тем же `auth.email` → `Error('account_online')`.
5. Жёсткий IP-бан (`getActiveIpBan`) → `Error('banned_perm')` / `Error('banned')` — как сейчас.
6. Возврат `{ email, ip }` → `client.auth`. **Ник и токен в auth больше не участвуют.**

### onJoin = лобби

Игрок **не** спавнится. Клиент помечается лобби-участником (признак — отсутствие `Player` в state для его sessionId; отдельного флага не заводим). Сервер отправляет:

- `charList`: `{ chars: [{ name, role }], copFull: boolean }` — `copFull` = онлайн-копов ≥ `COP_LIMIT`, чтобы UI гасил кнопки.

### Сообщения лобби (принимаются только пока у клиента нет `Player`)

- `createChar { name, role }`:
  - `countChars(email) >= CHARACTER_LIMIT` → `lobbyError { code: 'slots_full' }`.
  - ник: trim, 1–16 символов; пустой → `nick_bad`. Занят (`characters` или `players` имеют такой ник) → `nick_taken`.
  - роль: только `citizen|cop`, иначе → `role_bad`. Коп при `copFull` → `cop_full`.
  - успех → `createChar` в БД → `spawnPlayer`.
- `selectChar { name }`:
  - персонаж не найден или `char.email !== auth.email` → `not_found`.
  - активный бан по нику → `banned` / `banned_perm` (мут спавн не блокирует — он действует только на чат/SMS).
  - коп при `copFull` → `cop_full`.
  - успех → `spawnPlayer`.
- `deleteChar { name }`:
  - не свой/нет → `not_found`; успех → `deleteChar` в БД → свежий `charList` клиенту.
  - удаление возможно только из лобби: играемый персонаж удалить нельзя (клиент заспавнен — сообщения лобби он не шлёт, вторую одновременную сессию блокирует `account_online`).

Ошибки лобби уходят через `client.send('lobbyError', { code })` (обработчики сообщений не возвращают ошибки клиенту).

### spawnPlayer(client, char)

Нынешнее тело `onJoin`, перенесённое без изменений логики: вытеснение призрака того же ника, спавн у двери по роли **из записи персонажа** (не из join-options), загрузка прогресса, StateView, runtime (kills/deaths/playtime/rent), `smsInbox`, broadcast join. После спавна — `client.send('spawnOk')`.

Роль больше не читается из join-options; `COP_LIMIT` применяется при спавне (отказ `cop_full`), подмены роли на citizen больше нет — роль = идентичность персонажа.

### onLeave / реконнект

- Лобби-клиент (без `Player`) — молчаливый cleanup, без `allowReconnection`.
- Заспавненный — как сейчас (`frozen`, окно реконнекта 10 с).

### Удаляется

- Ник+токен ветка `onAuth`, `authToken`-сообщение, `bindEmail/bindPass`-путь, фолбэк-ник.
- `db.getAuth/bindEmail/getByEmail`, клейм `secret`.

## 3. Клиент

### Экран входа (`client/index.html`, `client/src/main.ts`)

- Поля: **email + пароль** (ник убран). Email предзаполняется из localStorage (`lastEmail`), пароль не хранится.
- Одна кнопка «Играть» (роль здесь больше не выбирается). Кнопки языка остаются.
- Маппинг ошибок: `need_email`, `bad_password`, `weak_password`, `bad_version`, `banned`, `banned_perm`, `account_online`, иначе общий `join.full`.

### Экран персонажей (`#chars`, новый)

- Показывается после `charList`: карточки (ник + роль), у каждой «Играть» и «Удалить» (confirm).
- Блок создания: инпут ника (maxlength 16) + две кнопки роли (`citizen`/`cop`); при `copFull` кнопка копа disabled; при 8 персонажах блок создания скрыт.
- `lobbyError` показывается на этом экране; после `createChar`/`deleteChar` сервер присылает свежий `charList` (кроме случая спавна).

### Поток

`connect(email, password)` → `charList` → экран `#chars` → `selectChar`/`createChar` → `spawnOk` + живой `serverTime` (нынешний `waitLiveState`) → `bootGame(room)`.

- `net.ts`: `connect(email, password)` — options `{ email, password, ver }`; `tok:`-localStorage и `role` в options удаляются.
- Кнопка «Выход» в настройках: reload; заодно чистит legacy `tok:*`.
- Реконнект 10 с — как сейчас; после полного релоада — экран логина.
- i18n ru+en: строки экрана персонажей, создания, удаления и новых ошибок (`need_email`, `account_online`, `nick_taken`, `nick_bad`, `role_bad`, `slots_full`, `cop_full`, `not_found`).

## 4. Затронутое без изменений поведения

- Баны/муты/админка — по нику, как раньше; проверка IP-бана переезжает из ник-ветки в email-ветку `onAuth` (уже единственную).
- `playtime_sec`, антифарм, переводы, рента, телефон — ключируются ником персонажа, не меняются.
- `savePlayer`/персист прогресса — без изменений.

## 5. Тесты

Основной объём — перевод интеграционных тестов на новый вход.

- Хелпер `joinWithChar(room, { email, password, name, role, ver })`: connectTo → дождаться `charList` → `createChar` → дождаться спавна (`state.players.has(sessionId)`). Все существующие интеграционные тесты переводятся на него.
- Юнит db (`server/test/db.test.ts`): миграция email-аккаунта в accounts+characters; `countChars`/лимит; уникальность ника; `deleteChar` чистит characters/players/sms.
- Интеграция (новый `chars.integration.test.ts` + правки `email.integration.test.ts`):
  - регистрация при первом входе; неверный пароль → `bad_password`; слабый пароль → `weak_password`; пустой email → `need_email`;
  - `account_online` при втором одновременном входе;
  - createChar: 8 слотов → `slots_full`; занятый ник → `nick_taken`; коп при полном лимите → `cop_full`;
  - selectChar чужого персонажа → `not_found`; забаненный ник → `banned`;
  - deleteChar → персонаж исчезает из `charList`, ник освобождается;
  - спавн кладёт роль из записи персонажа.
- Прогон: `npm test` из корня (shared+server) и `npm run typecheck` — зелёные.

## 6. Коммиты

Conventional-commits на русском, по одному на осмысленный слой: БД+миграция → сервер (auth/лобби/спавн) → клиент (экраны/i18n) → тесты-хелпер и перевод тестов. `PROTOCOL_VERSION=6` в первом же коммите, меняющем протокол.

## Открытые риски / осознанные упрощения

- Потеря пароля = потеря аккаунта (восстановления нет, почта не подтверждается) — принято для этого этапа.
- Пароль хранится только на сервере; на клиенте предзаполняется только email.
- Бан по нику переживает удаление персонажа: пересозданный ник остаётся забаненным (анти-обход важнее ложного срабатывания на новом владельце).
- Лобби-клиенты занимают место в комнате (`MAX_PLAYERS=100`) до выбора персонажа — приемлемо; таймаут лобби не вводим.
