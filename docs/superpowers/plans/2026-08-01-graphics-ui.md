# Графика и UI (S+M) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Воплотить спек `docs/superpowers/specs/2026-08-01-graphics-ui-design.md`: S-пак (тени, окна, зум+FOV, хитмаркер, F3+ping, sys-сообщения) и M-пак (коллизия камеры, инстансинг, день/ночь, настройки, онбординг, Tab-список).

**Architecture:** Всё — клиент `client/` (Three.js), кроме Tasks 5-6 (серверные сообщения ping/sys). Новые файлы: `client/src/settings.ts`, `client/src/tablist.ts`. Новые i18n-ключи добавляются в `client/src/i18n/ru.ts`/`en.ts` в задачах, которые их вводят (парность ключей гарантирует typecheck — en типизирован `Record<keyof typeof ru, string>`).

**Tech Stack:** Three.js 0.169 (`three/examples/jsm/utils/BufferGeometryUtils.js` — часть пакета three), Colyseus 0.16, Vitest для серверных задач.

## Global Constraints

- Node 20, ESM, TS strict; серверные импорты с суффиксом `.js`. Новых зависимостей НЕТ.
- Комментарии в коде — по-русски, коротко, про «почему».
- Все пользовательские строки — через i18n (`t()`, словари ru/en парные).
- Гейты после каждой задачи: `npm run typecheck` из корня; при серверных правках + `npm test`. Коммит conventional на русском, без AI-атрибуции.
- Текущий HEAD: `26f4184`. main, работаем по прецеденту прямо в main.

---

### Task 1: Тени (S1)

**Files:**
- Modify: `client/src/main.ts` (shadowMap enable)
- Modify: `client/src/world.ts` (sun castShadow, ground receive)
- Modify: `client/src/avatars.ts` (castShadow телам/головам/машинам)

**Interfaces:**
- Produces: включённый shadowMap; M4 (настройки) переключает `renderer.shadowMap.enabled` в рантайме.

- [ ] **Step 1: main.ts**

В `client/src/main.ts` после `const renderer = new THREE.WebGLRenderer({ antialias: true });` добавить:
```ts
  renderer.shadowMap.enabled = true; // тени — главный объём города; в настройках отключаются («низкое» качество)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

- [ ] **Step 2: world.ts**

Блок солнца (строки 35-37) заменить на:
```ts
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(100, 200, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.camera.far = 600;
  scene.add(sun);
  scene.add(sun.target); // цель — центр города (0,0,0)
```
В создание земли (после `ground.rotation.x = -Math.PI / 2;`) добавить `ground.receiveShadow = true;`. В цикле зданий после `mesh.position.set(...)` добавить `mesh.castShadow = true;`.

- [ ] **Step 3: avatars.ts**

В `makePlayerMesh`: после `body.position.y = 0.9;` добавить `body.castShadow = true;`; после `head.position.y = 1.9;` добавить `head.castShadow = true;`. В `makeCarMesh`: после `body.position.y = 0.55;` добавить `body.castShadow = true;`.

- [ ] **Step 4: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/main.ts client/src/world.ts client/src/avatars.ts
git commit -m "feat(client): тени — PCFSoft shadowMap, солнце castShadow 2048, земля принимает"
```

---

### Task 2: Окна на зданиях (S2)

**Files:**
- Modify: `client/src/world.ts` (текстура окон + material-массив для house)

**Interfaces:**
- Produces: `getWindowsTexture(): THREE.CanvasTexture` (синглтон модуля). Применяется только к `kind==='house'`.

- [ ] **Step 1: Реализация**

В `client/src/world.ts` после `makeTextSprite` добавить:
```ts
let windowsTex: THREE.CanvasTexture | null = null;

// окна жилых домов: белый фон (не трогает цвет материала) + тёмная сетка, часть «горит»
function getWindowsTexture(): THREE.CanvasTexture {
  if (windowsTex) return windowsTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 6; col++) {
      ctx.fillStyle = Math.random() < 0.15 ? '#ffd866' : '#33405c'; // ~15% окон светятся
      ctx.fillRect(8 + col * 20, 10 + row * 24, 12, 16);
    }
  }
  windowsTex = new THREE.CanvasTexture(canvas);
  return windowsTex;
}
```
Цикл зданий (строки 89-99) заменить на:
```ts
  for (const b of map.buildings) {
    // жилым — окна на боковых гранях (индексы 0,1,4,5), крыша/низ однотонные; спецздания — как раньше
    const mat = b.kind === 'house'
      ? [
          new THREE.MeshLambertMaterial({ color: b.color, map: getWindowsTexture() }),
          new THREE.MeshLambertMaterial({ color: b.color, map: getWindowsTexture() }),
          new THREE.MeshLambertMaterial({ color: b.color }),
          new THREE.MeshLambertMaterial({ color: b.color }),
          new THREE.MeshLambertMaterial({ color: b.color, map: getWindowsTexture() }),
          new THREE.MeshLambertMaterial({ color: b.color, map: getWindowsTexture() }),
        ]
      : new THREE.MeshLambertMaterial({ color: b.color });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.castShadow = true;
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
    const label = makeTextSprite(kindLabel(b.kind));
    label.position.set(b.x, b.h + 3, b.z);
    scene.add(label);
  }
```

- [ ] **Step 2: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/world.ts
git commit -m "feat(client): окна на жилых домах — canvas-текстура сеткой, часть окон «горит»"
```

---

### Task 3: Зум камеры колёсиком + FOV прицела (S3)

**Files:**
- Modify: `client/src/camera.ts` (новая сигнатура)
- Modify: `client/src/main.ts` (camDist, wheel, вызов)

**Interfaces:**
- Produces: `CAM_MIN = 4`, `CAM_MAX = 12`; `updateCamera(camera, x, z, yaw, dist, aiming, dt, colliders = [])` — colliders использует Task 7, здесь параметр добавлен, но пуст.

- [ ] **Step 1: camera.ts**

Заменить всё содержимое `client/src/camera.ts` на:
```ts
import * as THREE from 'three';
import { segmentAABBEnterT, type AABB } from '@mmo/shared';

export const CAM_MIN = 4;
export const CAM_MAX = 12;
const CAM_HEIGHT = 4;
const FOV_NORMAL = 70;
const FOV_AIM = 55;

// позицию передаёт main: предсказанная (пешком) или серверная (остальные режимы)
export function updateCamera(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
  yaw: number,
  dist: number,
  aiming: boolean,
  dt: number,
  colliders: AABB[] = [], // Task 7 передаёт здания; пусто — без коллизии
): void {
  let d = dist;
  if (colliders.length > 0) {
    // не даём камере уйти за стену: укорачиваем дистанцию до точки входа в AABB
    const cx = x + Math.sin(yaw) * dist;
    const cz = z + Math.cos(yaw) * dist;
    let tHit = 1;
    for (const b of colliders) {
      const th = segmentAABBEnterT(x, z, cx, cz, b);
      if (th !== null && th < tHit) tHit = th;
    }
    if (tHit < 1) d = Math.max(1.5, dist * tHit - 0.5);
  }
  camera.position.set(x + Math.sin(yaw) * d, CAM_HEIGHT, z + Math.cos(yaw) * d);
  camera.lookAt(x, 1.5, z);
  // прицел (ПКМ) сужает FOV, отпустил — вернулся
  const target = aiming ? FOV_AIM : FOV_NORMAL;
  if (Math.abs(camera.fov - target) > 0.1) {
    camera.fov += (target - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
}
```

- [ ] **Step 2: main.ts**

- импорт: `import { updateCamera, CAM_MIN, CAM_MAX } from './camera.js';` и `import { isTypingTarget } from './input.js';` (InputController импортируется отдельно — isTypingTarget именованный экспорт того же модуля, объединить в один import).
- в `bootGame` после `let lastCarId = '';` добавить `let camDist = 7;` и слушатель:
```ts
  // зум колёсиком — только когда не открыта карта/телефон и не печатаем
  window.addEventListener('wheel', (e) => {
    if (fullmap.isOpen || phone.isOpen || isTypingTarget()) return;
    camDist = Math.min(CAM_MAX, Math.max(CAM_MIN, camDist + Math.sign(e.deltaY)));
  }, { passive: true });
```
- вызов в цикле `updateCamera(camera, avatars.selfPos?.x ?? me.x, avatars.selfPos?.z ?? me.z, input.yaw);` заменить на:
```ts
      updateCamera(camera, avatars.selfPos?.x ?? me.x, avatars.selfPos?.z ?? me.z, input.yaw, camDist, input.aiming && document.pointerLockElement !== null, dt);
```

- [ ] **Step 3: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/camera.ts client/src/main.ts
git commit -m "feat(client): зум камеры колёсиком (4-12м), прицел ПКМ сужает FOV 70→55"
```

---

### Task 4: Хитмаркер + индикатор направления урона (S4)

**Files:**
- Modify: `client/index.html` (два div)
- Modify: `client/src/style.css` (стили)
- Modify: `client/src/effects.ts` (логика)

**Interfaces:**
- Produces: `#hitmarker`, `#dmgDir`; `Effects` показывает их в `onHit` (там уже звуки hitDealt/hitTaken).

- [ ] **Step 1: HTML+CSS**

`client/index.html` после `<div id="crosshair" class="hidden"></div>` добавить:
```html
    <div id="hitmarker" class="hidden">✕</div>
    <div id="dmgDir" class="hidden"></div>
```

`client/src/style.css` в конец:
```css
#hitmarker {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  color: #fff; font-size: 30px; font-weight: bold; text-shadow: 0 0 4px #000;
  pointer-events: none;
}
#dmgDir {
  position: absolute; top: 50%; left: 50%; width: 120px; height: 120px;
  border-radius: 50%; border: 30px solid transparent;
  border-top-color: rgba(255, 40, 40, .8); pointer-events: none;
}
```

- [ ] **Step 2: effects.ts**

`client/src/effects.ts`:
- поля дополнить:
```ts
  private hitmarker = document.getElementById('hitmarker')!;
  private hitmarkerTimer = 0;
  private dmgDir = document.getElementById('dmgDir')!;
  private dmgDirTimer = 0;
```
- в `onHit` блок звуков (`if (msg.attacker === myId ...) this.tone(...); if (msg.victim === myId) this.tone(...);`) заменить на:
```ts
    const myId = this.room.sessionId;
    if (msg.attacker === myId && msg.victim !== myId) {
      this.tone(880, 0.05, 'square', 0.05); // я попал
      this.flashHitmarker();
    }
    if (msg.victim === myId) {
      this.tone(140, 0.15, 'sawtooth', 0.09); // по мне
      this.showDamageFrom(msg.attacker ?? '');
    }
```
- добавить методы:
```ts
  // белый × в центре на 150 мс — подтверждение своего попадания
  private flashHitmarker(): void {
    this.hitmarker.classList.remove('hidden');
    clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => this.hitmarker.classList.add('hidden'), 150);
  }

  // красный клин со стороны атакующего (400 мс): угол = направление на него относительно моего rotY
  private showDamageFrom(attackerId: string): void {
    const me = (this.room.state.players as any).get(this.room.sessionId);
    const att = attackerId ? (this.room.state.players as any).get(attackerId) : null;
    if (!me || !att) return;
    const ang = Math.atan2(att.x - me.x, att.z - me.z) - me.rotY;
    // π - ang: 0 = атакующий прямо по курсу (клин сверху), проверено по осям (rotY: forward=(-sin,-cos))
    this.dmgDir.style.transform = `translate(-50%, -50%) rotate(${Math.PI - ang}rad)`;
    this.dmgDir.classList.remove('hidden');
    clearTimeout(this.dmgDirTimer);
    this.dmgDirTimer = window.setTimeout(() => this.dmgDir.classList.add('hidden'), 400);
  }
```
(`onHit` уже объявляет `const myId` в текущем коде — не дублировать: сверить и оставить одно объявление.)

- [ ] **Step 3: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/index.html client/src/style.css client/src/effects.ts
git commit -m "feat(client): хитмаркер при своём попадании, клин направления входящего урона"
```

---

### Task 5: ping/pong + F3-метрика (S5) + PROTOCOL_VERSION=4

**Files:**
- Modify: `server/src/rooms/CityRoom.ts` (обработчик ping)
- Modify: `shared/src/config.ts:2` (версия 4)
- Modify: `client/index.html`, `client/src/style.css`, `client/src/main.ts` (оверлей #debug)
- Test: `server/test/room.integration.test.ts` (ping)

**Interfaces:**
- Produces: сообщения `ping { t: number }` → `pong { t: number }` (эхо); `PROTOCOL_VERSION = 4`.

- [ ] **Step 1: Падающий тест**

В `server/test/room.integration.test.ts` добавить:
```ts
  it('ping отвечает pong с тем же payload', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'pinger', role: 'citizen' });
    let got: any = null;
    c1.onMessage('pong', (m) => { got = m; });
    c1.send('ping', { t: 12345 });
    await new Promise(r => setTimeout(r, 200));
    expect(got).toEqual({ t: 12345 });
  });
```

Run: `cd server && npx vitest run test/room.integration.test.ts` — FAIL (pong не приходит).

- [ ] **Step 2: Сервер + версия**

`server/src/rooms/CityRoom.ts` в `onCreate` после обработчика `leaderboardReq` добавить:
```ts
    this.onMessage('ping', (client, data) => client.send('pong', data)); // эхо для RTT-метрики клиента (F3)
```

`shared/src/config.ts:2` — `PROTOCOL_VERSION = 3` → `= 4` (комментарий тот же).

- [ ] **Step 3: Клиент**

`client/index.html` после `#feed` добавить `<div id="debug" class="hidden"></div>`.

`client/src/style.css` в конец:
```css
#debug {
  position: absolute; top: 40px; right: 10px; color: #9f9; font-size: 12px;
  font-family: monospace; background: rgba(0,0,0,.5); padding: 4px 8px;
  border-radius: 4px; pointer-events: none;
}
```

`client/src/main.ts`:
- после `let camDist = 7;` (Task 3) добавить:
```ts
  // F3 — FPS/пинг (пинг: эхо ping/pong раз в 2 с, только когда панель видна)
  const debugEl = document.getElementById('debug')!;
  let debugOn = false;
  let frames = 0;
  let fpsAt = performance.now();
  let fps = 0;
  let rtt = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3' && !e.repeat && !isTypingTarget()) {
      debugOn = !debugOn;
      debugEl.classList.toggle('hidden', !debugOn);
    }
  });
  let pingT = 0;
  setInterval(() => {
    if (!debugOn) return;
    pingT = performance.now();
    current.send('ping', { t: pingT });
  }, 2000);
```
- в `bindRoomMessages` добавить:
```ts
    r.onMessage('pong', (m: { t?: number }) => {
      if (typeof m?.t === 'number' && m.t === pingT) rtt = Math.round(performance.now() - m.t);
    });
```
- в игровом цикле после `renderer.render(scene, camera);` добавить:
```ts
    if (debugOn) {
      frames++;
      const nowMs = performance.now();
      if (nowMs - fpsAt >= 500) {
        fps = Math.round(frames * 1000 / (nowMs - fpsAt));
        frames = 0;
        fpsAt = nowMs;
        debugEl.textContent = `${fps} FPS · ${rtt} ms`;
      }
    }
```

- [ ] **Step 4: Гейт + Commit**

Run: `cd server && npx vitest run test/room.integration.test.ts && cd .. && npm test && npm run typecheck` — зелёные.
```bash
git add server/src/rooms/CityRoom.ts shared/src/config.ts server/test/room.integration.test.ts client/index.html client/src/style.css client/src/main.ts
git commit -m "feat: ping/pong + F3-панель FPS/RTT на клиенте, PROTOCOL_VERSION=4"
```

---

### Task 6: Системные сообщения join/leave в чат (S6)

**Files:**
- Modify: `server/src/rooms/CityRoom.ts` (broadcast sys, removePlayer silent)
- Modify: `client/src/ui.ts` (рендер sys в чате)
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts` (ключи sys.*)
- Modify: `client/src/style.css` (стиль .sysMsg)
- Test: `server/test/room.integration.test.ts` (sys join/leave)

**Interfaces:**
- Produces: broadcast `sys { code: 'join'|'leave', name: string, t: number }`; `removePlayer(id, silent?: boolean)`; ключи `sys.join`/`sys.leave`.

- [ ] **Step 1: Падающий тест**

В `server/test/room.integration.test.ts` добавить:
```ts
  it('sys: вход/выход игрока рассылается всем', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'watcher', role: 'citizen' });
    const msgs: any[] = [];
    c1.onMessage('sys', (m) => msgs.push(m));
    const c2 = await testServer.connectTo(room, { name: 'joiner', role: 'citizen' });
    await new Promise(r => setTimeout(r, 200));
    expect(msgs.some(m => m.code === 'join' && m.name === 'joiner')).toBe(true);
    await c2.leave();
    await new Promise(r => setTimeout(r, 11_000)); // окно реконнекта 10с — leave придёт после истечения
    expect(msgs.some(m => m.code === 'leave' && m.name === 'joiner')).toBe(true);
  }, 15_000);
```
(consented leave шлёт leave() → сервер кинет в catch → removePlayer сразу — окно не нужно ждать? Проверить: `onLeave(consented=true)` → `throw new Error('consented leave')` → catch → removePlayer. Да, consented убирает сразу — 11 сек не нужно, хватит 300 мс. Упростить ожидание до 300 мс и таймаут теста обычный.)

Run: `cd server && npx vitest run test/room.integration.test.ts -t sys` — FAIL.

- [ ] **Step 2: Сервер**

`server/src/rooms/CityRoom.ts`:
- в `onJoin` после `client.send('smsInbox', ...)` добавить:
```ts
    this.broadcast('sys', { code: 'join', name, t: this.state.serverTime }); // системное: вошёл в город
```
- `removePlayer`: сигнатуру заменить на `private removePlayer(id: string, silent = false): void {`, в блоке `if (p) {` после `this.state.players.delete(id);` добавить:
```ts
      if (!silent && p.role !== 'zombie') {
        this.broadcast('sys', { code: 'leave', name: p.name, t: this.state.serverTime }); // системное: вышел
      }
```
- в `onJoin` вызов призрака `this.removePlayer(ghostId);` → `this.removePlayer(ghostId, true); // вытеснение своего призрака — не «вышел»`.

- [ ] **Step 3: Клиент**

`client/src/i18n/ru.ts` добавить: `'sys.join': '{name} вошёл в город', 'sys.leave': '{name} вышел',`. `en.ts`: `'sys.join': '{name} joined the city', 'sys.leave': '{name} left',`.

`client/src/style.css` в конец:
```css
#chat div.sysMsg { color: #aaa; font-style: italic; }
```

`client/src/ui.ts`:
- в `bind(room)` добавить:
```ts
    room.onMessage('sys', (m: { code: string; name: string; t?: number }) => {
      this.appendChat({ from: '*', text: t(`sys.${m.code}`, { name: m.name }), t: m.t });
    });
```
- в `appendChat` после создания `div` добавить:
```ts
    if (msg.from === '*') {
      div.textContent = msg.text; // системное: без «от кого», курсивом
      div.className = 'sysMsg';
      this.chat.append(div);
      if (atBottom) this.chat.scrollTop = this.chat.scrollHeight;
      return;
    }
```
(Дедуп-ключ уже содержит `msg.t` — сервер шлёт serverTime, повторный join того же ника не отрежется.)

- [ ] **Step 4: Гейт + Commit**

Run: `cd server && npx vitest run test/room.integration.test.ts && cd .. && npm test && npm run typecheck` — зелёные.
```bash
git add server/src/rooms/CityRoom.ts client/src/ui.ts client/src/i18n/ru.ts client/src/i18n/en.ts client/src/style.css server/test/room.integration.test.ts
git commit -m "feat: системные сообщения в чат — игрок вошёл/вышел (sys join/leave)"
```

---

### Task 7: Коллизия камеры (M1)

**Files:**
- Modify: `client/src/main.ts` (коллайдеры в вызов updateCamera)

**Interfaces:**
- Consumes: `updateCamera(..., colliders)` (Task 3, параметр уже есть); `segmentAABBEnterT` из `@mmo/shared` (уже импортирован в camera.ts).

- [ ] **Step 1: main.ts**

В `bootGame` после `const map = buildWorld(scene);` (или `const { map, fx } = ...` — смотря по Task 9 порядку; Task 7 идёт ДО Task 9, так что `const map = buildWorld(scene);`) добавить:
```ts
  const camColliders = map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d })); // коллизия камеры (M1)
```
Вызов `updateCamera(...)` дополнить последним аргументом `camColliders` (после `dt`).

- [ ] **Step 2: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/main.ts
git commit -m "feat(client): коллизия камеры — не уходит за стены зданий"
```

---

### Task 8: Инстансинг разметки и забора (M2)

**Files:**
- Modify: `client/src/world.ts` (merge геометрий)

**Interfaces:**
- Produces: один меш разметки + один меш забора вместо ~650 мелких. Импорт `mergeGeometries` из `three/examples/jsm/utils/BufferGeometryUtils.js` (часть пакета three, НЕ новая зависимость).

- [ ] **Step 1: Реализация**

`client/src/world.ts`:
- импорт: `import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';`
- блок штрихов разметки (цикл `for (let d = -MAP_HALF + DASH_STEP; ...)`) — собирать геометрии вместо мешей: перед циклом дорог объявить `const dashGeos: THREE.BufferGeometry[] = [];`, внутри вместо `const dash = new THREE.Mesh(...); dash.position.set(...); scene.add(dash);` — `const g = new THREE.BoxGeometry(vertical ? 0.4 : DASH_LENGTH, 0.02, vertical ? DASH_LENGTH : 0.4); g.translate(vertical ? at : d, 0.03, vertical ? d : at); dashGeos.push(g);`. После ВСЕГО цикла дорог (после строки 87 `}`):
```ts
  // сотни штрихов — одним мешем: ~400 draw calls экономии (мобилка)
  const dashes = mergeGeometries(dashGeos, false);
  if (dashes) scene.add(new THREE.Mesh(dashes, lineMat));
```
- забор: перед циклом `for (const z of map.safeZones)` объявить `const fenceGeos: THREE.BufferGeometry[] = [];`; в `seg` вместо создания меша:
```ts
    const seg = (x: number, zz: number, w: number, d: number) => {
      const g = new THREE.BoxGeometry(w, 1.2, d);
      g.translate(x, 0.6, zz);
      fenceGeos.push(g);
    };
```
  после цикла safeZones (перед `// кладбище`):
```ts
  const fence = mergeGeometries(fenceGeos, false);
  if (fence) scene.add(new THREE.Mesh(fence, fenceMat));
```

- [ ] **Step 2: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/world.ts
git commit -m "perf(client): разметка и забор слиты в 2 меша (mergeGeometries) — сотни draw calls меньше"
```

---

### Task 9: День/ночь (M3)

**Files:**
- Modify: `client/src/world.ts` (fx)
- Modify: `client/src/main.ts` (деструктуризация, вызов в цикле)

**Interfaces:**
- Produces: `buildWorld(scene): { map: CityMap; fx: WorldFx }`; `interface WorldFx { update(now: number): void }`. main дергает `fx.update(performance.now())` каждый кадр.

- [ ] **Step 1: world.ts**

- после импортов добавить:
```ts
export interface WorldFx { update(now: number): void }
const DAY_MS = 10 * 60_000; // полный цикл день/ночь
```
- сигнатуру `export function buildWorld(scene: THREE.Scene): CityMap {` заменить на `export function buildWorld(scene: THREE.Scene): { map: CityMap; fx: WorldFx } {`.
- ambient-свет вынести в переменную: `scene.add(new THREE.AmbientLight(0xffffff, 0.5));` → `const amb = new THREE.AmbientLight(0xffffff, 0.5); scene.add(amb);`
- перед `return map;` вставить:
```ts
  // день/ночь: плавный лерп солнца/неба/тумана по 10-минутному циклу
  const skyDay = new THREE.Color(0x87ceeb);
  const skyNight = new THREE.Color(0x0a0a2e);
  const sunDay = new THREE.Color(0xffffff);
  const sunNight = new THREE.Color(0x8899ff);
  const bg = scene.background as THREE.Color;
  const fogColor = (scene.fog as THREE.Fog).color;
  const fx: WorldFx = {
    update(now: number) {
      const phase = ((now + DAY_MS * 0.3) % DAY_MS) / DAY_MS; // сдвиг фазы: вход — день
      const d = 0.5 + 0.5 * Math.sin((phase - 0.25) * Math.PI * 2); // 0 = полночь, 1 = полдень
      sun.intensity = 0.25 + 0.95 * d;
      amb.intensity = 0.25 + 0.3 * d;
      sun.color.lerpColors(sunNight, sunDay, d);
      bg.lerpColors(skyNight, skyDay, d);
      fogColor.lerpColors(skyNight, skyDay, d);
    },
  };
```
- `return map;` → `return { map, fx };`

- [ ] **Step 2: main.ts**

- `const map = buildWorld(scene);` → `const { map, fx } = buildWorld(scene);` (camColliders из Task 7 остаётся — использует `map`).
- в игровом цикле после `renderer.render(scene, camera);` или рядом с `effects.update`: добавить `fx.update(performance.now());`.

- [ ] **Step 3: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/world.ts client/src/main.ts
git commit -m "feat(client): день/ночь — 10-минутный цикл солнца, неба и тумана"
```

---

### Task 10: Меню настроек Esc (M4)

**Files:**
- Create: `client/src/settings.ts`
- Modify: `client/index.html` (оверлей #settings)
- Modify: `client/src/style.css` (стили)
- Modify: `client/src/effects.ts` (volume)
- Modify: `client/src/ui.ts` (Esc-ветку убрать, closeDialogs/dialogsOpen публичные)
- Modify: `client/src/phone.ts`, `client/src/fullmap.ts` (Esc-ветки убрать)
- Modify: `client/src/main.ts` (Esc-диспетчер)
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts` (ключи settings.*)

**Interfaces:**
- Consumes: тени Task 1 (переключение shadowMap в рантайме).
- Produces: `class Settings { isOpen; open(); close() }`; `Effects.setVolume(v: number)`, `Effects.volume: number`; `UI.dialogsOpen(): boolean`, `UI.closeDialogs()` — публичный; ключи `settings.title/volume/mute/lang/quality/qualityHigh/qualityLow/langNote`.

- [ ] **Step 1: effects.ts — громкость**

`client/src/effects.ts`:
- поле добавить: `volume = Number(localStorage.getItem('vol') ?? '1') || 1; // 0..1, слайдер настроек` (публичное).
- метод:
```ts
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('vol', String(this.volume));
  }
```
- в `tone()` строку `gain.gain.setValueAtTime(vol, t0);` заменить на `gain.gain.setValueAtTime(vol * this.volume, t0);`.

- [ ] **Step 2: HTML+CSS+словари**

`client/index.html` после `#reconnectOverlay` добавить:
```html
    <div id="settings" class="hidden">
      <div class="panel">
        <h2 data-i18n="settings.title"></h2>
        <label><span data-i18n="settings.volume"></span><input id="setVolume" type="range" min="0" max="100"></label>
        <label><input id="setMute" type="checkbox"><span data-i18n="settings.mute"></span></label>
        <div class="row"><span data-i18n="settings.lang"></span><button id="setRu">RU</button><button id="setEn">EN</button></div>
        <div class="row"><span data-i18n="settings.quality"></span>
          <select id="setQuality">
            <option value="high" data-i18n="settings.qualityHigh"></option>
            <option value="low" data-i18n="settings.qualityLow"></option>
          </select>
        </div>
        <button id="settingsClose" data-i18n="dialog.close"></button>
      </div>
    </div>
```

`client/src/style.css` в конец:
```css
#settings {
  position: fixed; inset: 0; z-index: 8; display: flex;
  align-items: center; justify-content: center; background: rgba(0,0,0,.5);
}
#settings .panel {
  background: rgba(20,20,40,.97); color: #fff; padding: 24px;
  border-radius: 10px; display: flex; flex-direction: column; gap: 14px;
  min-width: 300px; pointer-events: auto;
}
#settings h2 { margin: 0; font-size: 18px; }
#settings label { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
#settings .row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
#settings input[type=range] { flex: 1; }
#settings select { background: #1c1c1c; color: #eee; border: 1px solid #444; padding: 5px 8px; }
```

`client/src/i18n/ru.ts` добавить:
```ts
  'settings.title': 'Настройки',
  'settings.volume': 'Громкость',
  'settings.mute': 'Без звука',
  'settings.lang': 'Язык',
  'settings.quality': 'Качество',
  'settings.qualityHigh': 'Высокое',
  'settings.qualityLow': 'Низкое',
  'settings.langNote': 'Подписи в мире обновятся после перезахода',
```
`client/src/i18n/en.ts`:
```ts
  'settings.title': 'Settings',
  'settings.volume': 'Volume',
  'settings.mute': 'Mute',
  'settings.lang': 'Language',
  'settings.quality': 'Quality',
  'settings.qualityHigh': 'High',
  'settings.qualityLow': 'Low',
  'settings.langNote': 'World labels will update after rejoin',
```

- [ ] **Step 3: settings.ts**

Создать `client/src/settings.ts`:
```ts
import * as THREE from 'three';
import { setLang, applyStatic, t } from './i18n/index.js';
import type { Effects } from './effects.js';
import type { InputController } from './input.js';

// Меню настроек (Esc): громкость/мьют, язык, качество (тени + pixelRatio).
// Открывается центральным Esc-диспетчером в main (когда остальные оверлеи закрыты).
export class Settings {
  isOpen = false;
  private root = document.getElementById('settings')!;

  constructor(
    private effects: Effects,
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private input: InputController,
    private toast: (s: string) => void,
  ) {
    const vol = document.getElementById('setVolume') as HTMLInputElement;
    vol.value = String(Math.round(effects.volume * 100));
    vol.addEventListener('input', () => effects.setVolume(Number(vol.value) / 100));
    const mute = document.getElementById('setMute') as HTMLInputElement;
    mute.checked = effects.muted;
    mute.addEventListener('change', () => { if (effects.muted !== mute.checked) effects.toggleMute(); });
    document.getElementById('setRu')!.addEventListener('click', () => this.setLanguage('ru'));
    document.getElementById('setEn')!.addEventListener('click', () => this.setLanguage('en'));
    const quality = document.getElementById('setQuality') as HTMLSelectElement;
    quality.value = localStorage.getItem('quality') ?? 'high';
    this.applyQuality(quality.value);
    quality.addEventListener('change', () => {
      localStorage.setItem('quality', quality.value);
      this.applyQuality(quality.value);
    });
    document.getElementById('settingsClose')!.addEventListener('click', () => this.close());
  }

  private setLanguage(l: 'ru' | 'en'): void {
    setLang(l);
    applyStatic();
    this.toast(t('settings.langNote')); // 3D-подписи запечены при построении мира
  }

  // низкое качество = pixelRatio 1 + без теней (перекомпиляция материалов обязательна)
  private applyQuality(q: string): void {
    const high = q !== 'low';
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.shadowMap.enabled = high;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  open(): void {
    this.isOpen = true;
    document.exitPointerLock();
    this.input.setBlocked(true);
    this.root.classList.remove('hidden');
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.setBlocked(false);
    this.root.classList.add('hidden');
  }
}
```

- [ ] **Step 4: Центральный Esc-диспетчер**

`client/src/ui.ts`:
- `private closeDialogs()` сделать публичным (`closeDialogs(): void`).
- добавить метод:
```ts
  dialogsOpen(): boolean {
    return !this.safeDialog.classList.contains('hidden') || !this.shopDialog.classList.contains('hidden');
  }
```
- Esc-слушатель в конструкторе (`window.addEventListener('keydown', (e) => { if (e.code === 'Escape') this.closeDialogs(); });`) УДАЛИТЬ — теперь центральный в main.

`client/src/phone.ts`: в keydown-обработчике конструктора убрать ветку `else if (e.code === 'Escape' && this.isOpen) this.close();` (P-тоггл остаётся).

`client/src/fullmap.ts`: аналогично убрать `else if (e.code === 'Escape' && this.isOpen) this.close();` (M-тоггл остаётся).

`client/src/main.ts`:
- импорт: `import { Settings } from './settings.js';`
- в `bootGame` после создания `phone`/`fullmap` добавить:
```ts
  const settings = new Settings(effects, renderer, scene, input, (s) => ui.showToast(s));
```
- после wheel-слушателя (Task 3) добавить диспетчер:
```ts
  // центральный Esc: закрывает оверлеи по очереди, если ничего не открыто — меню настроек
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat || isTypingTarget()) return;
    if (phone.isOpen) phone.close();
    else if (fullmap.isOpen) fullmap.close();
    else if (ui.dialogsOpen()) ui.closeDialogs();
    else if (settings.isOpen) settings.close();
    else settings.open();
  });
```

- [ ] **Step 5: Гейт + Commit**

Run: `npm run typecheck && npm test` — зелёные.
```bash
git add client/
git commit -m "feat(client): меню настроек Esc — громкость, язык, качество (тени/pixelRatio); центральный Esc-диспетчер"
```

---

### Task 11: Онбординг-тосты (M5)

**Files:**
- Modify: `client/src/main.ts`
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts` (ключи hint.*)

**Interfaces:**
- Produces: ключи `hint.move/car/wanted`; localStorage `seenIntro`.

- [ ] **Step 1: Словари**

`client/src/i18n/ru.ts` добавить:
```ts
  'hint.move': 'WASD — движение, мышь — камера, колесо — зум',
  'hint.car': 'Заработок — доставка: сядь в машину (E), затем P → Работа',
  'hint.wanted': 'Красный маркер — розыскной. За такого дают награду',
```
`client/src/i18n/en.ts`:
```ts
  'hint.move': 'WASD — move, mouse — camera, wheel — zoom',
  'hint.car': 'Earn by delivery: enter a car (E), then P → Job',
  'hint.wanted': 'Red marker — wanted player. There is a bounty for them',
```

- [ ] **Step 2: main.ts**

В `bootGame` в конце (после `renderer.setAnimationLoop(...)`) добавить:
```ts
  // онбординг — один раз на браузер, три подсказки с паузами
  if (!localStorage.getItem('seenIntro')) {
    localStorage.setItem('seenIntro', '1');
    (['hint.move', 'hint.car', 'hint.wanted'] as const).forEach((key, i) => {
      setTimeout(() => ui.showToast(t(key)), 1000 + i * 4000);
    });
  }
```

- [ ] **Step 3: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/src/main.ts client/src/i18n/ru.ts client/src/i18n/en.ts
git commit -m "feat(client): онбординг — три подсказки новичку при первом входе"
```

---

### Task 12: Список игроков по Tab (M6)

**Files:**
- Create: `client/src/tablist.ts`
- Modify: `client/index.html`, `client/src/style.css`, `client/src/main.ts`
- Modify: `client/src/i18n/ru.ts`, `client/src/i18n/en.ts` (ключ tab.title)

**Interfaces:**
- Produces: `class TabList { bind(room); update() }` — bind для реконнекта (паттерн Task 16 прошлой программы).

- [ ] **Step 1: HTML+CSS+словарь**

`client/index.html` после `#settings` добавить `<div id="tablist" class="hidden"></div>`.

`client/src/style.css` в конец:
```css
#tablist {
  position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
  min-width: 260px; max-height: 60vh; overflow-y: auto;
  background: rgba(0,0,0,.65); border-radius: 8px; padding: 10px 14px;
  color: #fff; font-size: 14px; pointer-events: none;
}
#tablist .tabTitle { font-weight: bold; margin-bottom: 6px; }
#tablist .tabRow { display: flex; justify-content: space-between; gap: 16px; padding: 1px 0; }
#tablist .tabRow.cop span:last-child { color: #77aaff; }
```

`client/src/i18n/ru.ts`: `'tab.title': 'Игроки онлайн',`. `en.ts`: `'tab.title': 'Players online',`.

- [ ] **Step 2: tablist.ts**

Создать `client/src/tablist.ts`:
```ts
import { t } from './i18n/index.js';
import { isTypingTarget } from './input.js';
import type { Room } from 'colyseus.js';

// Список игроков по удержанию Tab: ник + роль, копы первыми. Ники — только textContent (XSS).
export class TabList {
  private root = document.getElementById('tablist')!;
  private open = false;
  private room!: Room;
  private refreshAt = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab' || e.repeat || isTypingTarget()) return;
      e.preventDefault(); // Tab не уводит фокус в браузерный chrome
      this.open = true;
      this.root.classList.remove('hidden');
      this.render();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Tab') return;
      this.open = false;
      this.root.classList.add('hidden');
    });
  }

  bind(room: Room): void {
    this.room = room;
  }

  update(): void {
    if (this.open && performance.now() - this.refreshAt > 1000) this.render();
  }

  private render(): void {
    this.refreshAt = performance.now();
    const rows: { name: string; role: string }[] = [];
    (this.room.state.players as any).forEach((p: any) => {
      if (p.role !== 'zombie') rows.push({ name: p.name, role: p.role });
    });
    rows.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'cop' ? -1 : 1));
    this.root.textContent = '';
    const title = document.createElement('div');
    title.className = 'tabTitle';
    title.textContent = `${t('tab.title')} (${rows.length})`;
    this.root.append(title);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = `tabRow ${r.role}`;
      const name = document.createElement('span');
      name.textContent = r.name;
      const role = document.createElement('span');
      role.textContent = t(`role.${r.role}`);
      row.append(name, role);
      this.root.append(row);
    }
  }
}
```

- [ ] **Step 3: main.ts**

- импорт: `import { TabList } from './tablist.js';`
- в `bootGame` после `const feed = new Feed();` добавить `const tablist = new TabList();` и рядом с `feed.bind(current);` — `tablist.bind(current);`.
- в успешном реконнекте (рядом с `feed.bind(fresh);`) добавить `tablist.bind(fresh);`.
- в игровом цикле после `ui.update();` добавить `tablist.update();`.

- [ ] **Step 4: Гейт + Commit**

Run: `npm run typecheck` — чисто.
```bash
git add client/
git commit -m "feat(client): список игроков по Tab — онлайн с ролями, копы первыми"
```

---

### Task 13: Финальные гейты + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Гейты**

Run: `npm run typecheck && npm test` (из корня) — зелёные (38 shared + ~220 server, зафиксировать факт).

- [ ] **Step 2: README**

В `README.md`:
- «Управление» дополнить: `колесо — зум камеры, ПКМ — прицел (сужает FOV), F3 — FPS/пинг, Tab — список игроков, Esc — меню настроек (громкость, язык, качество)`.
- Фичи дополнить: тени и окна на зданиях, день/ночь (10 мин цикл), системные сообщения входа/выхода в чате, хитмаркер и индикатор направления урона, онбординг-подсказки.
- Числа тестов — фактические из Step 1.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — графика (тени/окна/день-ночь), UI (F3/Tab/Esc), числа тестов"
```
