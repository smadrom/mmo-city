# Пакет «интерполяция + ощущения машины» — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Спек `docs/superpowers/specs/2026-08-03-interp-carfeel-design.md`.

## Global Constraints

- Node 20, ESM, TS strict, `.js`-суффиксы. Новых зависимостей НЕТ. Комментарии по-русски про «почему».
- Гейты: `npm run typecheck`; при shared/server правках + `npm test`. Коммит conventional на русском, без AI-атрибуции.
- Протокол не меняется (схема/сообщения не тронуты) — PROTOCOL_VERSION НЕ бампим.
- main, HEAD: `b2de89e`.

---

### Task 1: Адаптивный джиттер-буфер + catmull-rom + экстраполяция (avatars.ts)

**Files:** `client/src/avatars.ts`

- [ ] **Step 1:** удалить `const INTERP_DELAY_MS = 120;`. Добавить:
```ts
const MIN_DELAY_MS = 60;
const MAX_DELAY_MS = 250;
const EXTRAPOLATE_CAP_S = 0.25; // дальше — заморозка (патчей нет совсем)
```
- [ ] **Step 2:** в `Avatars` — трекинг патчей: поля `private patchIntervals: number[] = []; private lastPatchAt = 0;`. В существующем `room.onStateChange` (перекалибровка serverOffset) добавить:
```ts
      const now = performance.now();
      if (this.lastPatchAt) {
        this.patchIntervals.push(now - this.lastPatchAt);
        if (this.patchIntervals.length > 10) this.patchIntervals.shift();
      }
      this.lastPatchAt = now;
```
и метод:
```ts
  // адаптивная задержка интерполяции: медиана интервала патчей ×1.5 + запас, в рамках 60..250мс
  private renderDelay(): number {
    if (this.patchIntervals.length < 3) return 150; // данных мало — безопасный дефолт
    const sorted = [...this.patchIntervals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, med * 1.5 + 30));
  }
```
- [ ] **Step 3:** `sampleSnap` заменить на (catmull-rom + экстраполяция):
```ts
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number, segLen: number): number {
  const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const maxDev = Math.max(1, segLen * 1.5); // анти-overshoot: резкий разворот не должен выкидывать за угол
  return Math.max(p2 - maxDev, Math.min(p2 + maxDev, v));
}

function sampleSnap(buf: Snap[], rt: number): Snap | null {
  if (buf.length === 0) return null;
  const last = buf[buf.length - 1];
  if (rt >= last.t) {
    // экстраполяция по последней скорости при разрыве патчей (кап EXTRAPOLATE_CAP_S)
    if (buf.length < 2) return last;
    const prev = buf[buf.length - 2];
    const dt = Math.min(EXTRAPOLATE_CAP_S, (rt - last.t) / 1000);
    const span = Math.max(1, last.t - prev.t) / 1000;
    return {
      t: rt,
      x: last.x + ((last.x - prev.x) / span) * dt,
      z: last.z + ((last.z - prev.z) / span) * dt,
      rotY: last.rotY,
    };
  }
  if (rt <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (a.t <= rt) {
      const d = b.t - a.t;
      const alpha = d > 0 ? (rt - a.t) / d : 1; // равные t — свежий снап, без 0/0
      const p0 = buf[i - 2] ?? a;
      const p3 = buf[i + 1] ?? b;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      return {
        t: rt,
        x: catmullRom(p0.x, a.x, b.x, p3.x, alpha, segLen),
        z: catmullRom(p0.z, a.z, b.z, p3.z, alpha, segLen),
        rotY: lerpAngle(a.rotY, b.rotY, alpha),
      };
    }
  }
  return buf[0];
}
```
- [ ] **Step 4:** в `update()`: `const rt = nowServer - INTERP_DELAY_MS;` → `const rt = nowServer - this.renderDelay();`.
- [ ] **Step 5:** `npm run typecheck` → коммит `feat(client): адаптивный джиттер-буфер, catmull-rom интерполяция, экстраполяция при разрывах`.

---

### Task 2: Нитро на Shift + отскок при столкновении (stepCar)

**Files:** `shared/src/config.ts`, `shared/src/physics.ts`, `shared/test/physics.test.ts`, `server/test/vehicles.test.ts` (если ассертит speed=0 при таране стены)

- [ ] **Step 1: config.** `CAR_MAX_SPEED = 20` → `= 26`. Добавить:
```ts
export const CAR_NITRO_SPEED_MULT = 1.5; // Shift в машине — нитро
export const CAR_NITRO_ACCEL_MULT = 1.3;
export const CAR_CRASH_BOUNCE = 0.25; // отскок при столкновении: speed = -speed × это
```
- [ ] **Step 2: physics.ts stepCar.** Импорт дополнить тремя константами. Блок газа:
```ts
  const nitro = inp.sprint;
  const maxSpeed = nitro ? CAR_MAX_SPEED * CAR_NITRO_SPEED_MULT : CAR_MAX_SPEED;
  const accel = nitro ? CAR_ACCEL * CAR_NITRO_ACCEL_MULT : CAR_ACCEL;
  if (inp.up) s.speed = Math.min(maxSpeed, s.speed + accel * dt);
  else if (inp.down) {
    s.speed = s.speed > 0
      ? Math.max(0, s.speed - CAR_BRAKE * dt)
      : Math.max(-CAR_REVERSE_SPEED, s.speed - accel * dt);
  } else if (s.speed > 0) s.speed = Math.max(0, s.speed - CAR_DRAG * dt);
  else if (s.speed < 0) s.speed = Math.min(0, s.speed + CAR_DRAG * dt);
```
Столкновение: `if (collidesAny(...)) { s.speed = 0; }` → `if (collidesAny(...)) { s.speed = -s.speed * CAR_CRASH_BOUNCE; // отскок, не гвозди }` (заодно в обработке беззоны оставить `s.speed = 0` как есть). agility использует CAR_MAX_SPEED (базовый, не нитро) — оставить.
- [ ] **Step 3: тесты.** physics.test.ts: кейс нитро (up+sprint: speed растёт выше CAR_MAX_SPEED до 39), столкновение → `speed === -startSpeed * CAR_CRASH_BOUNCE`. vehicles.test.ts: найти ассерты `speed).toBe(0)` после тарана стены — обновить на отскок.
- [ ] **Step 4:** `cd shared && npx vitest run && cd ../server && npx vitest run test/vehicles.test.ts && cd .. && npm test && npm run typecheck` → коммит `feat(shared): нитро на Shift (×1.5 скорость), отскок при столкновении вместо полного стопа`.

---

### Task 3: Динамическая камера в машине

**Files:** `client/src/main.ts`, `client/src/camera.ts` (если нужен roll — только через rotateZ после lookAt)

- [ ] **Step 1: camera.ts** — после `camera.lookAt(x, 1.5, z);` в конец updateCamera добавить параметры: сигнатуру расширить `roll = 0` последним опциональным и `if (roll) camera.rotateZ(roll); // крен в повороте машины`.
- [ ] **Step 2: main.ts.** Поля в bootGame: `let camSmX = 0, camSmZ = 0, camInit = false, camShake = 0, lastOwnSpeed = 0;`. В цикле заменить блок камеры:
```ts
      const targetX = avatars.selfCarPos?.x ?? avatars.selfPos?.x ?? me.x;
      const targetZ = avatars.selfCarPos?.z ?? avatars.selfPos?.z ?? me.z;
      if (!camInit) { camSmX = targetX; camSmZ = targetZ; camInit = true; }
      const inCar = me.mode === 'car';
      // пружинный лаг камеры: в машине мягче, пешком цепче
      const k = Math.min(1, dt * (inCar ? 5 : 10));
      camSmX += (targetX - camSmX) * k;
      camSmZ += (targetZ - camSmZ) * k;
      // тряска при резкой потере скорости (столкновение/наезд по мне)
      const ownSpeed = inCar && ownCar ? Math.abs(ownCar.speed) : 0;
      if (lastOwnSpeed - ownSpeed > 8) camShake = 0.5;
      lastOwnSpeed = ownSpeed;
      camShake = Math.max(0, camShake - dt * 1.5);
      const shakeX = camShake ? (Math.random() - 0.5) * camShake : 0;
      const shakeZ = camShake ? (Math.random() - 0.5) * camShake : 0;
      const speedBoost = inCar && ownCar ? Math.abs(ownCar.speed) / CAR_MAX_SPEED * 3 : 0;
      const steer = inCar && ownCar ? ownCar.steer : 0;
      const roll = inCar && ownCar ? -steer * (Math.abs(ownCar.speed) / CAR_MAX_SPEED) * 0.06 : 0;
      updateCamera(camera, camSmX + shakeX, camSmZ + shakeZ, input.yaw, camDist + speedBoost, input.aiming && document.pointerLockElement !== null, dt, camColliders, roll);
```
Импорт `CAR_MAX_SPEED` из `@mmo/shared` дополнить.
- [ ] **Step 3:** `npm run typecheck` → коммит `feat(client): динамическая камера в машине — лаг, зум по скорости, крен, тряска`.

---

### Task 4: Звук машины + следы шин

**Files:** `client/src/effects.ts`, возможно `client/src/carfx.ts` (новый, если effects разрастётся — держим в effects)

- [ ] **Step 1: effects.ts — мотор.** Поля: `private engineOsc: OscillatorNode | null = null; private engineGain: GainNode | null = null;`. Методы:
```ts
  // мотор своей машины: зацикленный пилой, питч/громкость от скорости
  engineStart(): void {
    if (this.engineOsc || this.muted) return;
    try {
      this.audio ??= new AudioContext();
      this.engineOsc = this.audio.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(50, this.audio.currentTime);
      this.engineGain = this.audio.createGain();
      this.engineGain.gain.setValueAtTime(0.0001, this.audio.currentTime);
      this.engineOsc.connect(this.engineGain).connect(this.audio.destination);
      this.engineOsc.start();
    } catch { this.engineOsc = null; this.engineGain = null; }
  }
  engineUpdate(speed: number): void {
    if (!this.engineOsc || !this.engineGain || !this.audio) return;
    this.engineOsc.frequency.setTargetAtTime(40 + Math.abs(speed) * 3, this.audio.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(Math.min(0.06, 0.015 + Math.abs(speed) * 0.0015) * this.volume, this.audio.currentTime, 0.1);
  }
  engineStop(): void {
    try { this.engineOsc?.stop(); } catch { /* уже остановлен */ }
    this.engineOsc = null;
    this.engineGain = null;
  }
```
- [ ] **Step 2: update(me)** — в существующем `update(me?: { mode: string })` расширить тип до `me?: { mode: string; speed?: number }` — нет, скорость не в Player; main передаёт ownCar.speed отдельно: сигнатуру `update(me, carSpeed = 0)`. Логика: `mode==='car'` → engineStart (если нет) + engineUpdate(carSpeed); иначе engineStop. При `muted` в tone-гардах — engineStart уже проверяет.
- [ ] **Step 3: визг и удар.** В main (там же детект из Task 3): при `down` нажатом и `ownSpeed > 12` — `effects.skid()` (один вызов в ~0.5с, гард по времени); при падении скорости >8 — `effects.crash()` (вместе с camShake). В effects:
```ts
  skid(): void { this.tone(900, 0.3, 'sawtooth', 0.04, 400); } // визг шин
  crash(): void { this.tone(90, 0.25, 'square', 0.1, 40); }    // удар о стену
  private lastSkidAt = 0;
```
гард времени в main или в skid — в skid: `if (performance.now() - this.lastSkidAt < 600) return; this.lastSkidAt = performance.now();`.
- [ ] **Step 4: следы шин.** Поля: `private skidmarks: { mesh: THREE.Mesh; bornAt: number }[] = []; private skidmat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6 });`. Метод:
```ts
  // тёмная полоска под машиной при резком торможении (детект по патчам в main, своя и чужие)
  addSkidmark(x: number, z: number, rotY: number): void {
    if (this.skidmarks.length > 200) {
      const old = this.skidmarks.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.6), this.skidmat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotY;
    mesh.position.set(x, 0.035, z);
    this.scene.add(mesh);
    this.skidmarks.push({ mesh, bornAt: performance.now() });
  }
```
в `update()` — затухание: `const SKIDMARK_MS = 10_000;` пройтись по массиву, удалять старше 10с, opacity по остатку.
В main цикле по всем машинам: хранить `lastCarSpeeds = new Map<string, number>()`; каждый патч-кадр: если `last - |speed| > 8` → `effects.addSkidmark(car.x, car.z, car.rotY)` и `effects.skid()` если близко (<30м до меня, опционально тон только для своей). Обновлять map.
- [ ] **Step 5:** `npm run typecheck` → коммит `feat(client): звук машины (мотор/визг/удар), следы шин при резком торможении`.

---

### Task 5: Гейты + README + выкат на прод

- [ ] **Step 1:** `npm run typecheck && npm test` — зелёные (факт чисел зафиксировать).
- [ ] **Step 2:** README «Управление»: в машине Shift — нитро; камера/следы — в фичи. Числа тестов.
- [ ] **Step 3:** коммит `docs: README — нитро, динамическая камера, интерполяция`.
- [ ] **Step 4:** выкат: `git push`, archive → VPS (deploy@ через jump gs) → `docker compose build && up -d` → healthz + probe-джойн (ver 5).
