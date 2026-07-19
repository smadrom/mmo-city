# Этап «Чат» — дизайн-документ

Дата: 2026-07-19
Статус: утверждён пользователем (по секциям)
Предшественники: `2026-07-17-mmo-real-life-mvp-design.md` (MVP влит), `2026-07-18-arsenal-design.md` (Арсенал влит)

## 1. Обзор

Общий текстовый чат для всего сервера. Закрывает социальную дыру: 100 игроков в городе не могут договориться. Рамки MVP сохраняются (100 игроков, тик 20 Гц), чат не попадает в state-sync Colyseus — ездит обычными сообщениями комнаты.

## 2. Решения, принятые на брейншторме

| Вопрос | Решение |
|---|---|
| Тип чата | Общий для всего сервера, одна лента |
| История | Последние 20 сообщений новичку при входе (ринг-буфер в памяти комнаты, без БД) |
| UI | Лента слева внизу (~7 видимых) + поле ввода по Enter, Esc закрывает |
| Лимиты | 1–120 символов после trim; не чаще 1 сообщения в 1.5 с на игрока; без фильтра мата |
| Транспорт | Сообщения комнаты (`'chat'`, `'chatHistory'`), НЕ схема Colyseus |
| Режимы | Чат доступен в любом mode (foot/car/jail/dead) |

## 3. Протокол и константы

`shared/src/config.ts` (единый источник правды):

```ts
export const CHAT_MAX_LEN = 120;
export const CHAT_COOLDOWN_MS = 1500;
export const CHAT_HISTORY = 20;
```

- Клиент → сервер: `'chat' { text: string }`.
- Сервер → всем: `'chat' { from: string, text: string, t: number }` — `t` = `state.serverTime` на момент приёма (для будущей сортировки/затухания, клиент сейчас не использует).
- Сервер → новичку: `'chatHistory' { items: { from, text, t }[] }` одним сообщением в `onJoin`.
- Валидация на сервере: строка, `trim`, длина 1..`CHAT_MAX_LEN`, `now - lastChatAt >= CHAT_COOLDOWN_MS`. Невалидное молча игнорируется (спека 6.2 MVP сохраняется).

## 4. Сервер

- `server/src/systems/chat.ts`: чистая `tryChat(state, runtimes, playerId, text, now): { from, text, t } | null` — проверки из р.3, при успехе ставит `rt.lastChatAt = now` и возвращает сообщение с `from = p.name`, `t = state.serverTime`.
- `server/src/runtime.ts`: `Runtime` += `lastChatAt: number` (init 0).
- `server/src/rooms/CityRoom.ts`:
  - поле `chatLog: { from: string; text: string; t: number }[] = []`;
  - `onMessage('chat')`: `const msg = tryChat(...); if (msg) { this.chatLog.push(msg); if (this.chatLog.length > CHAT_HISTORY) this.chatLog.shift(); this.broadcast('chat', msg); }`
  - `onJoin` (после установки игрока): `client.send('chatHistory', { items: this.chatLog })`.

## 5. Клиент

- `client/index.html` += `#chat` (лента) и `#chatInput` (скрытое поле ввода) внутри `#hud`.
- `client/src/style.css`: лента слева внизу над `#prompt`, полупрозрачный фон как у `#stats`, max-height на ~7 строк, моноширинность не нужна; `#chatInput` — строка ввода под лентой.
- `client/src/ui.ts`:
  - `room.onMessage('chat', msg => appendChat(msg))`, `room.onMessage('chatHistory', h => h.items.forEach(appendChat))`;
  - `appendChat`: `div` с `textContent = `${msg.from}: ${msg.text}`` (только textContent — XSS невозможен), автоскролл ленты вниз;
  - `Enter` (когда поле скрыто): `document.exitPointerLock()`, показать `#chatInput`, фокус;
  - `Enter` в поле: непустой `trim` → `room.send('chat', { text })`, очистить, скрыть, blur; пустое — просто скрыть;
  - `Escape` в поле: очистить, скрыть, blur (pointer lock вернётся по следующему клику по canvas — существующее поведение);
  - свои сообщения рендерятся серверным эхом (broadcast идёт и отправителю), локального эха нет.
- `client/src/input.ts`: в обработчиках `keydown`/`keyup` и в тике отправки `input` — если `document.activeElement` — поле чата, клавиши игнорируются (WASD не ходит, E не шлёт interact); клик-атака не затронута (pointer lock на тот момент снят, клик вне canvas).

## 6. Тестирование

- **Юнит (Vitest):** `tryChat` — валидное сообщение (возврат `{from, text, t}`, `lastChatAt` обновлён); trim пробелов; пустое после trim → null; >120 → null; cooldown 1.5 с → null; неизвестный playerId → null.
- **Интеграция (`@colyseus/testing`):** сообщение одного клиента доставляется второму с корректным `from/text`; новичок, зашедший после сообщения, получает `chatHistory` с ним; два сообщения подряд (в пределах cooldown) — второе не доходит.
- **Гейт:** `npm test` (shared + server), `npx tsc --noEmit` во всех пакетах, `npm run build -w client`.

## 7. Что НЕ входит в этап

Личные сообщения/каналы, proximity-чат, фильтр мата, модерация/баны, персистентность истории в БД, пузыри над головами, звук/мигание при новом сообщении, команды (`/me`, `/w`).
