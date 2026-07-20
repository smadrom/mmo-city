# Этап «Карта и телефон» — дизайн-документ

Дата: 2026-07-20
Статус: утверждён пользователем (по секциям в брейншторме)
Предшественники: `2026-07-17-mmo-real-life-mvp-design.md` (MVP), `2026-07-20-combat-cars-zombies-design.md` (бой/машины/зомби, влит)

## 1. Обзор

Две фичи: (а) карта — постоянная миникарта в HUD + полноэкранная карта по клавише; (б) телефон — оверлей с тремя приложениями: SMS (личные сообщения с историей в БД), Банк (переводы по нику), Работа (удалённый приём заказа доставки). Рамки сохраняются: 100 игроков, тик 20 Гц, телефон ездит сообщениями комнаты (не схемой Colyseus), карта целиком клиентская — рисуется из `shared/map.ts`, нового сетевого трафика не создаёт.

## 2. Решения, принятые на брейншторме

| Вопрос | Решение |
|---|---|
| Вид карты | Миникарта в углу + полная карта по `M` |
| Метки на карте | Только свои (игрок, последняя машина, цель заказа) + POI; чужих игроков НЕТ |
| Телефон | SMS + приложения Банк и Работа; звонков и NPC-сервисов нет |
| SMS | Любому игроку по нику, даже офлайн; история в БД |
| Банк | Баланс + переводы налички (`cash`) по нику; сейф не участвует |
| Работа | Приём/отказ от заказа удалённо; выполнение — как раньше, доехать до точки |
| Рендер карты | Canvas 2D из данных `shared/map.ts` (не WebGL, не SVG) |

## 3. Константы (`shared/src/config.ts`)

```ts
export const SMS_MAX_LEN = 140;
export const SMS_COOLDOWN_MS = 1500;
export const SMS_THREAD_LIMIT = 50;    // сообщений на диалог за раз
export const SMS_HISTORY_COOLDOWN_MS = 5000; // как у chatHistoryReq
export const TRANSFER_MIN = 1;
export const TRANSFER_MAX = 100_000;
export const TRANSFER_HISTORY = 10;
export const MINIMAP_SIZE = 200;       // px, диаметр
export const MINIMAP_RADIUS = 60;      // метров обзора от центра
export const FULLMAP_MAX_ZOOM = 6;     // кратность от «весь город влез»
```

## 4. Карта (клиент, `client/src/minimap.ts`)

Один рендерер, два режима (mini / full). Данные: `createCityMap()` из shared + live-state комнаты.

- **Статичный слой** (offscreen-canvas, создаётся один раз): фон (тёмно-зелёный), дороги (`ROADS` × `ROAD_WIDTH`, серые полосы + перекрёстки сами собой), здания-прямоугольники (спецздания цветные: больница/полиция/склад). Масштаб слоя 1 px = 1 м, размер `2*MAP_HALF`².
- **Миникарта**: круглый canvas `MINIMAP_SIZE` px в правом нижнем углу (левый занят чатом), CSS `border-radius: 50%` + `ctx.clip()`. Каждый кадр: `drawImage` статики с трансформом «игрок в центре, масштаб = (SIZE/2)/RADIUS», север всегда вверх. Метки: стрелка игрока (поворот по `rotY`), последняя машина (клиент запоминает `carId`, где был водителем; показывает, пока у неё нет другого водителя), цель заказа (флажок, если `cargo`), POI-точки в радиусе. Позиция своя — из prediction (сырой state).
- **Полная карта**: `M` — оверлей на весь экран (`pointer-events: auto`), тот же статичный слой, влезает целиком; зум колёсиком (1..`FULLMAP_MAX_ZOOM`), пан drag'ом; подписи POI и спецзданий (Больница, Полиция, Склад, Магазин, Заправка, Порт, Оружейный из `TARGET_LABELS` + литералы). Метки те же, что на миникарте. Закрытие — `M`/`Esc`.
- POI-набор: больница, полиция, склад, оружейный магазин, 3 цели доставки.

## 5. Телефон (клиент, `client/src/phone.ts`)

DOM-оверлей в `index.html`/`style.css`: «корпус» ~320×560 справа снизу поверх миникарты. Открытие/закрытие — `P` (и `Esc`); при открытии `document.exitPointerLock()`. Домашний экран: 3 иконки + часы (serverTime).

- **SMS**: список диалогов (ник, последний текст, бейдж непрочитанных) → экран переписки (скролл, свои справа), поле ввода (maxlength `SMS_MAX_LEN`) + «Новое сообщение» (поле ника). Открытие переписки шлёт `smsRead`. Входящее SMS: тост «SMS от <ник>» + бейдж на иконке телефона в HUD.
- **Банк**: баланс (`cash` из state), поля ник+сумма, кнопка «Перевести», список последних `TRANSFER_HISTORY` переводов (обе стороны). Результат — тост из `transferResult`.
- **Работа**: если заказа нет — кнопка «Взять заказ»; если есть — цель (`TARGET_LABELS`), остаток времени до дедлайна, кнопка «Отказаться». Статус целиком из state (`cargo`, `deliveryTarget`, `deliveryDeadline`) — отдельных сообщений не нужно.

## 6. Ввод и клавиши (`client/src/input.ts`)

Состояния UI: `game | chat | phone | map`. Когда открыт телефон/карта/чат-инпут — WASD, атаки, `E` глушатся. `P`/`M` не срабатывают при фокусе в текстовом поле (существующий typing-guard по `activeElement`). Pointer lock возвращается по клику на canvas — существующее поведение.

## 7. Сервер

- **`server/src/systems/messages.ts`** (новый): `trySms(state, runtimes, db, playerId, to, text, now)` — trim, 1..`SMS_MAX_LEN`, кулдаун `SMS_COOLDOWN_MS` (`rt.lastSmsAt`), нельзя себе, получатель существует в БД; при успехе `db.addSms` и возврат записи.
- **Переводы** (`server/src/systems/economy.ts`): `tryTransfer(state, db, playerId, to, amount, now)` — целое `TRANSFER_MIN..TRANSFER_MAX`, получатель существует, не себе, хватает `cash`. Атомарно в `db.transfer` (транзакция better-sqlite3: `UPDATE ... WHERE name=? AND cash>=?`, проверка `changes`, зачисление получателю, запись в историю). Онлайн-сторонам обновить `cash` в state.
- **Работа**: рефактор `tryStartDelivery` → `canTakeDelivery(p)` (машина, нет груза) + `assignDelivery(p, map, now)`; NPC-путь у склада сохраняет проверку дистанции, телефонный `jobTake` её пропускает (груз «заказан по телефону», но машина обязательна). `jobDrop` — снять `cargo`/`deliveryTarget`.
- **`CityRoom.ts`**: обработчики `sms`, `smsHistoryReq`, `smsThreadReq {with}`, `smsRead {with}`, `transfer {to, amount}`, `jobTake`, `jobDrop`. Ответы: `sms` (эхо отправителю + онлайн-получателю), `smsResult {ok, error?}`, `smsHistory` (диалоги через SQL `GROUP BY` + непрочитанные), `smsThread`, `transferResult {ok, error?, balance}`, `jobResult {ok, error?}`. При входе — `smsInbox {unread}` для бейджа. Rate-limit историй — как у чата.
- **`runtime.ts`**: `Runtime` += `lastSmsAt`, `lastSmsHistoryAt` (init 0).
- Схема Colyseus **не меняется** (всё нужное уже в `Player`).

## 8. БД (`server/src/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_nick TEXT NOT NULL, to_nick TEXT NOT NULL,
  text TEXT NOT NULL, ts INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sms_inbox ON sms(to_nick, is_read);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_nick TEXT NOT NULL, to_nick TEXT NOT NULL,
  amount INTEGER NOT NULL, ts INTEGER NOT NULL
);
```

Методы `GameDB`: `addSms`, `unreadCount(nick)`, `getDialogs(nick)`, `getThread(a, b, limit)`, `markRead(me, with)`, `transfer(from, to, amount): boolean`, `getTransfers(nick, limit)`. Создание таблиц идемпотентно — старая `game.db` подхватится без миграции. Офлайн-получатель SMS/перевода увидит всё при входе (баланс и так грузится из БД).

## 9. Ошибки и края

- Невалидный `sms` (пусто, длиннее лимита, себе, нет такого ника, спам) — `smsResult {ok:false, error}` отправителю, клиент показывает тост; в БД не пишется.
- Перевод: недостаток средств / нет ника / себе / вне лимитов — `transferResult {ok:false}`; гонки сумм закрыты SQL-условием `cash>=?` в транзакции.
- `jobTake` без машины или с активным заказом — `jobResult {ok:false}`.
- XSS: весь пользовательский текст только через `textContent` (как в чате).

## 10. Тестирование

- `server/test/messages.test.ts`: валидация SMS, кулдаун, себе, несуществующий ник, офлайн-получатель (запись в БД, unread), доставка онлайн-получателю.
- `server/test/economy.test.ts` += переводы: успех, нехватка средств, себе, нет ника, офлайн-получатель (БД), история; удалённый `jobTake`/`jobDrop` (требование машины, конфликт с активным заказом, NPC-путь со складом не сломан).
- Клиент: ручной чек-лист в README += миникарта/полная карта/телефон/SMS/перевод (два клиента рядом).
- Деплой: клиент и сервер выкатывать вместе (новые сообщения протокола).
