# Пакет «прод-фидбек 1» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Спек `docs/superpowers/specs/2026-08-03-prod-feedback-1-design.md`: пинг всегда виден, игроки на карте, предсказание машины, email+выход.

## Global Constraints

- Node 20, ESM, TS strict; серверные импорты `.js`. Новых зависимостей НЕТ (scrypt — node:crypto).
- Комментарии по-русски, про «почему». Строки UI — через i18n (ru/en парные).
- Гейты: `npm run typecheck`; при серверных правках + `npm test`. Коммит conventional на русском, без AI-атрибуции.
- HEAD старта: `68d4e6b`+ (после deploy-коммитов). main.

---

### Task 1: Пинг всегда виден

**Files:** `client/src/main.ts`, `client/src/ui.ts`

- [ ] **Step 1:** `main.ts` — setInterval пинга: убрать гард `if (!debugOn) return;`, период 2000→5000:
```ts
  setInterval(() => {
    pingT = performance.now(); // пинг всегда (дёшево), F3-панель — только для FPS
    current.send('ping', { t: pingT });
  }, 5000);
```
pong-обработчик в `bindRoomMessages` дополнить `ui.setPing(rtt);` после вычисления rtt.

- [ ] **Step 2:** `ui.ts` — поле `private pingMs = -1;`, метод:
```ts
  setPing(ms: number): void { this.pingMs = ms; } // rtt из pong (main), −1 = ещё не измерен
```
в `update()` первая строка stats: `...${t('stats.safe')}: ${me.safe}$` → дописать `${this.pingMs >= 0 ? `  ·  ${this.pingMs} ms` : ''}`.

- [ ] **Step 3:** `npm run typecheck` → коммит `feat(client): пинг измеряется постоянно и выводится в HUD-статы`.

---

### Task 2: Игроки на карте

**Files:** `client/src/minimap.ts`, `client/src/main.ts`

- [ ] **Step 1:** `minimap.ts` — `MapMarker` расширить: `kind: 'car' | 'target' | 'player'` и опциональное `color?: string`. В `renderMinimap` ветку меток заменить цвет на: `m.color ?? (m.kind === 'car' ? '#ffcc00' : m.kind === 'target' ? '#ff4444' : '#66aaff')`. В `renderFull` аналогично для markers: цвет `m.color ?? (m.kind === 'car' ? '#ffcc00' : '#ff4444')`.

- [ ] **Step 2:** `main.ts` — в цикле, где собираются markers (после car/target):
```ts
      const nowSrv = avatars.serverNow();
      (current.state.players as any).forEach((p: any, id: string) => {
        if (id === current.sessionId || p.role === 'zombie') return; // себя рисует стрелка, зомби — шум
        markers.push({
          x: p.x, z: p.z, kind: 'player',
          color: p.wantedUntil > nowSrv ? '#ff3333' : p.role === 'cop' ? '#4477ff' : '#ffffff',
        });
      });
```

- [ ] **Step 3:** `npm run typecheck` → коммит `feat(client): игроки на миникарте и полной карте (роли, розыск красным)`.

---

### Task 3: Предсказание своей машины

**Files:** `shared/src/physics.ts`, `server/src/systems/vehicles.ts`, `client/src/prediction.ts`, `client/src/avatars.ts`, `client/src/main.ts`, `shared/test/physics.test.ts`

**Interfaces:** `interface CarStepState { x, z, rotY, speed }`; `stepCar(s: CarStepState, inp: MoveInput, dt: number, colliders: AABB[], safeZones?: AABB[]): { steer: number }` (мутирует s, возвращает steer для отображения руля).

- [ ] **Step 1: shared stepCar + тест.** В `shared/src/physics.ts` импорт дополнить `CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG, CAR_TURN_RATE, CAR_RADIUS` и добавить (порт 1:1 из vehicles.ts блока водителя: газ/тормоз/драг, руль с agility, движение/коллизия/разворот от беззоны). В `shared/test/physics.test.ts` тесты: разгон по up (speed растёт до CAR_MAX_SPEED), тормоз до 0, драг гасит, поворот меняет rotY, столкновение обнуляет speed, беззона разворачивает rotY на π.
- [ ] **Step 2: vehicles.ts** — блок водителя (accel/drag/steer/move) заменить вызовом stepCar:
```ts
      const inp = rt.input;
      const s: CarStepState = { x: car.x, z: car.z, rotY: car.rotY, speed: car.speed };
      const { steer } = stepCar(s, inp, dt, colliders, safeZones);
      car.x = s.x; car.z = s.z; car.rotY = s.rotY; car.speed = s.speed;
      car.steer = steer;
```
(`CarStepState`/`stepCar` в импорте из `@mmo/shared`.) Прогон `cd server && npx vitest run test/vehicles.test.ts` — зелёно (поведение не менялось).
- [ ] **Step 3: prediction.ts** — поле `car: CarStepState | null = null` (публичное), в конструкторе сохранить `this.safeZones = map.safeZones`; update расширить параметром `serverCar?: { x: number; z: number; rotY: number; speed: number }`:
```ts
    if (mode === 'car' && serverCar) {
      if (!this.car) this.car = { ...serverCar };
      const pdt = Math.min(dt, 0.1);
      stepCar(this.car, input, pdt, this.colliders, this.safeZones);
      const dx = serverCar.x - this.car.x;
      const dz = serverCar.z - this.car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 9) this.car = { ...serverCar }; // телепорт/сильный рассинхрон — жёсткий snap
      else if (d2 > 0.25) { // мягкий догон, иначе резинит
        const k = Math.min(1, pdt * 5);
        this.car.x += dx * k;
        this.car.z += dz * k;
      }
      this.x = this.car.x;
      this.z = this.car.z;
      return true;
    }
    this.car = null;
```
(дальше существующая логика foot/остальных режимов.)
- [ ] **Step 4: main.ts + avatars.ts.** `Avatars` += поле `selfCarPos: { x: number; z: number; rotY: number } | null = null;`; в `cars.forEach` ветка `c.driverId === this.room.sessionId`: позиция/поворот из `this.selfCarPos ?? { x: c.x, z: c.z, rotY: c.rotY }`. `main.ts` в цикле:
```ts
      const ownCar = me.mode === 'car' ? (current.state.cars as any).get(me.carId) : undefined;
      const predicted = prediction.update(dt, input.current, me.mode, me.x, me.z, ownCar);
      avatars.selfPos = predicted && me.mode === 'foot' ? { x: prediction.x, z: prediction.z } : null;
      avatars.selfCarPos = predicted && me.mode === 'car' && prediction.car
        ? { x: prediction.car.x, z: prediction.car.z, rotY: prediction.car.rotY }
        : null;
```
(камера уже идёт по selfPos/prediction — для car использовать prediction.x/z в updateCamera: сейчас `updateCamera(camera, avatars.selfPos?.x ?? me.x, ...)` — заменить источник на `avatars.selfCarPos?.x ?? avatars.selfPos?.x ?? me.x` и то же для z.)
- [ ] **Step 5:** `npm run typecheck && npm test` → коммит `feat: предсказание своей машины — общий stepCar в shared, рендер/камера по предсказанию`.

---

### Task 4: Email-привязка + выход + PROTOCOL_VERSION=5

**Files:** `shared/src/config.ts`, `server/src/db.ts`, `server/src/auth.ts` (новый), `server/src/rooms/CityRoom.ts`, `client/index.html`, `client/src/net.ts`, `client/src/main.ts`, `client/src/settings.ts`, `client/src/i18n/ru.ts`, `client/src/i18n/en.ts`, тесты `server/test/db.test.ts`, `server/test/room.integration.test.ts` (или новый `email.integration.test.ts`)

**Interfaces:**
- `hashPassword(pw: string): string` → `salt:hashHex` (scrypt 32); `verifyPassword(pw, stored): boolean` (timingSafeEqual) — `server/src/auth.ts`.
- БД: колонки `email`, `passhash` (TEXT DEFAULT ''); `bindEmail(name, email, passhash)`; `getByEmail(email): { name, passhash } | null`.
- onAuth options += `email?: string; password?: string`; auth payload в onJoin: `{ name, ip, bindEmail?, bindPass? }`.
- `authToken` сообщение теперь `{ token, name }` — клиент сохраняет токен под m.name.

- [ ] **Step 1: auth.ts** (scrypt helpers) + **db.ts** (миграция + 2 метода) + тесты db (bind/getByEmail).
- [ ] **Step 2: onAuth.** После проверки ver, до name-ветки:
```ts
    const email = String(options?.email ?? '').trim().toLowerCase().slice(0, 64);
    const password = String(options?.password ?? '');
    if (email) {
      const acc = this.db.getByEmail(email);
      if (acc) {
        if (!verifyPassword(password, acc.passhash)) throw new Error('bad_password');
        const existingId = this.findSessionByName(acc.name);
        if (existingId && !this.runtimes.get(existingId)?.frozen) throw new Error('name_online');
        const rawIp = context?.ip;
        const ip = Array.isArray(rawIp) ? (rawIp[0] ?? '') : (rawIp ?? '').split(',')[0].trim();
        const ban = this.db.getActiveBan(acc.name, Date.now()) ?? this.db.getActiveIpBan(ip, Date.now());
        if (ban) throw new Error(ban.until === null ? 'banned_perm' : 'banned');
        return { name: acc.name, ip }; // вход по email: ник восстановлен, токен не нужен
      }
      if (password.length < 4) throw new Error('weak_password'); // привязка новой почты — минимум 4
    }
```
в конце name-ветки (успешной) `return { name, ip, ...(email ? { bindEmail: email, bindPass: password } : {}) };`
- [ ] **Step 3: onJoin** — после `const rec = this.db.load(name);`:
```ts
    const auth = client.auth as { name: string; ip?: string; bindEmail?: string; bindPass?: string };
    if (auth.bindEmail && auth.bindPass && !rec.email && !this.db.getByEmail(auth.bindEmail)) {
      this.db.bindEmail(name, auth.bindEmail, hashPassword(auth.bindPass)); // первая привязка — перезапись запрещена
    }
```
и `client.send('authToken', { token: rec.secret ?? '', name });` (добавить name).
- [ ] **Step 4: Клиент.** index.html: после nameInput два поля (`#emailInput` type=email, `#passInput` type=password, data-i18n-ph join.emailPh/join.passPh). net.ts: `connect(name, role, email?, password?)` — в join options добавить email/password когда непустые; authToken-обработчик сохраняет под `m.name ?? name`. main.ts start(): `if (!name && !email)` → ошибка; проброс в connect; ошибки: bad_password → `t('join.badPassword')`, weak_password → `t('join.weakPassword')`. Словари: join.emailPh 'Email (необязательно)'/'Email (optional)', join.passPh 'Пароль (необязательно)'/'Password (optional)', join.badPassword 'Неверный пароль'/'Wrong password', join.weakPassword 'Пароль минимум 4 символа'/'Password min 4 chars', settings.logout 'Выйти из аккаунта'/'Log out'. settings.ts: кнопка `#setLogout`:
```ts
    document.getElementById('setLogout')!.addEventListener('click', () => {
      for (const k of Object.keys(localStorage).filter(k => k.startsWith('tok:'))) localStorage.removeItem(k); // сброс клейма ника
      location.reload();
    });
```
index.html в settings-панель добавить кнопку.
- [ ] **Step 5: PROTOCOL_VERSION = 5** в shared/config.ts.
- [ ] **Step 6: Тесты.** db.test.ts: bindEmail/getByEmail roundtrip, неизвестный → null. integration: (a) join с email+password (ник свободен) → authToken приходит с name; повторный join с тем же email БЕЗ токена и с другим ником в опциях → входит под исходным ником (email резолвит); (b) неверный password → bad_password; (c) email + короткий password → weak_password.
- [ ] **Step 7:** `npm test && npm run typecheck` → коммит `feat: email-привязка аккаунта (scrypt), вход по email, кнопка выхода, PROTOCOL_VERSION=5`.

---

## Финал (после T4, без отдельной задачи-ревью — этот план малый)

`npm run typecheck && npm test` → выкат на прод `git push && ./deploy/deploy.sh` (deploy@ через jump gs) → проверка https://mmo.expw.net + probe-джойн (свежий ник, ver 5).
