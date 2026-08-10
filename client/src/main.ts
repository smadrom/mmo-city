import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect, reconnect } from './net.js';
import { Avatars } from './avatars.js';
import { InputController, isTypingTarget } from './input.js';
import { Prediction } from './prediction.js';
import { updateCamera, CAM_MIN, CAM_MAX } from './camera.js';
import { UI } from './ui.js';
import { Effects } from './effects.js';
import { Pickups } from './pickups.js';
import { CityMapRenderer, type MapMarker } from './minimap.js';
import { Fullmap } from './fullmap.js';
import { Phone } from './phone.js';
import { Settings } from './settings.js';
import { Feed } from './feed.js';
import { TabList } from './tablist.js';
import { TouchControls } from './touch.js';
import { t, setLang, getLang, applyStatic } from './i18n/index.js';
import type { Room } from 'colyseus.js';
import { CAR_MAX_SPEED, CHARACTER_LIMIT, dist2 } from '@mmo/shared';

applyStatic(); // статика экрана входа — сразу на языке пользователя

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

document.getElementById('langRu')!.addEventListener('click', () => { setLang('ru'); applyStatic(); });
document.getElementById('langEn')!.addEventListener('click', () => { setLang('en'); applyStatic(); });

let connecting = false;

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

// первый ROOM_STATE приходит отдельным сообщением после join/reconnect, и в нём
// serverTime ещё 0 — ждём живое значение, иначе поля state undefined и съезжают таймеры
async function waitLiveState(room: Room): Promise<void> {
  while (!room.state.serverTime) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }
}

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true; // тени — главный объём города; в настройках отключаются («низкое» качество)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // чёткость на Retina; кап 2 — перф
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const { map, fx } = buildWorld(scene);
  const camColliders = map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d })); // коллизия камеры (M1)
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  const ui = new UI(room, map, avatars, input);
  const effects = new Effects(scene, room, avatars);
  const pickups = new Pickups(scene, room);
  const mapRenderer = new CityMapRenderer(map);
  const fullmap = new Fullmap(mapRenderer, input);
  const phone = new Phone(room, map, input, (text) => ui.showToast(text), () => avatars.serverNow());
  const settings = new Settings(effects, renderer, scene, input, (s) => ui.showToast(s));
  const feed = new Feed();
  const tablist = new TabList();
  const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  const prediction = new Prediction();
  const overlay = document.getElementById('reconnectOverlay')!;
  let current = room;
  let lastCarId = '';
  let camDist = 7;
  let camSmX = 0, camSmZ = 0, camInit = false, camShake = 0, lastOwnSpeed = 0;
  const lastCarSpeeds = new Map<string, number>(); // скорость машин прошлого кадра — детект резкого торможения
  let reconnecting = false;

  // зум колёсиком — только когда не открыта карта/телефон и не печатаем
  window.addEventListener('wheel', (e) => {
    if (fullmap.isOpen || phone.isOpen || isTypingTarget()) return;
    camDist = Math.min(CAM_MAX, Math.max(CAM_MIN, camDist + Math.sign(e.deltaY)));
  }, { passive: true });

  // центральный Esc: закрывает оверлеи по очереди, если ничего не открыто — меню настроек
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || e.repeat || isTypingTarget()) return;
    if (phone.isOpen) phone.close();
    else if (fullmap.isOpen) fullmap.close();
    else if (ui.dialogsOpen()) ui.closeDialogs();
    else if (settings.isOpen) settings.close();
    else settings.open();
  });

  // F3 — FPS/пинг (пинг: эхо ping/pong раз в 5 с всегда — значение в HUD-статах)
  const debugEl = document.getElementById('debug')!;
  let debugOn = false;
  let frames = 0;
  let fpsAt = performance.now();
  let fps = 0;
  let rtt = 0;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3' && !e.repeat && !isTypingTarget()) {
      e.preventDefault(); // Firefox: F3 открывает поиск по странице
      debugOn = !debugOn;
      debugEl.classList.toggle('hidden', !debugOn);
      if (!debugOn) { frames = 0; fpsAt = performance.now(); } // сброс окна замера — иначе повторное включение смешает старое
    }
  });
  let pingT = 0;
  setInterval(() => {
    pingT = performance.now(); // пинг всегда (дёшево), F3-панель — только для FPS
    current.send('ping', { t: pingT });
  }, 5000);

  phone.onOpen = () => fullmap.close();
  fullmap.onOpen = () => phone.close();
  feed.bind(current);
  tablist.bind(current);

  // effects создан раньше — его keydown переключает mute первым, здесь читаем уже новое значение
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget()) return; // не срабатываем при печати в чате/полях
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
      } // старый text-формат не принимаем — старые клиенты отвергнуты PROTOCOL_VERSION
    });
    r.onMessage('delivered', (m: { reward: number }) => {
      ui.showToast(`+${m.reward}$`); // сумма числом — универсально для обоих языков
      effects.cashIn();
    });
    r.onMessage('pong', (m: { t?: number }) => {
      if (typeof m?.t === 'number' && m.t === pingT) {
        rtt = Math.round(performance.now() - m.t);
        ui.setPing(rtt);
      }
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
        // fresh может умереть до первого живого патча — без таймаута цикл повис бы навсегда
        await Promise.race([
          waitLiveState(fresh),
          new Promise((_, reject) => setTimeout(() => reject(new Error('state_timeout')), 2000)),
        ]);
        current = fresh;
        avatars.rebind(fresh);
        pickups.rebind(fresh);
        effects.bind(fresh);
        ui.bind(fresh);
        phone.bind(fresh);
        feed.bind(fresh);
        tablist.bind(fresh);
        input.setRoom(fresh);
        prediction.reset();
        bindRoomMessages(fresh);
        overlay.classList.add('hidden');
        reconnecting = false;
        return;
      } catch { /* сервер ещё держит место или недоступен — следующая попытка */ }
    }
    location.reload(); // окно вышло — на экран входа (email предзаполнится из lastEmail)
  };

  bindRoomMessages(room);

  // тач-управление: hooks шлют через current — после реконнекта попадают в новую комнату
  new TouchControls(input, {
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
    const ownCar = me && me.mode === 'car' ? (current.state.cars as any).get(me.carId) : undefined;
    if (me) {
      const predicted = prediction.update(dt, input.current, me.mode, me.x, me.z, ownCar, current.state.serverTime ?? 0, rtt);
      avatars.selfPos = predicted && me.mode === 'foot' ? { x: prediction.x, z: prediction.z } : null;
      avatars.selfCarPos = predicted && me.mode === 'car' && prediction.car
        ? { x: prediction.car.x, z: prediction.car.z, rotY: prediction.car.rotY }
        : null;
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
      if (lastOwnSpeed - ownSpeed > 8) { camShake = 0.5; effects.crash(); } // удар: тряска + звук
      lastOwnSpeed = ownSpeed;
      if (inCar && input.current.down && ownSpeed > 12) effects.skid(); // торможение с визгом (гард 600 мс внутри)
      camShake = Math.max(0, camShake - dt * 1.5);
      const shakeX = camShake ? (Math.random() - 0.5) * camShake : 0;
      const shakeZ = camShake ? (Math.random() - 0.5) * camShake : 0;
      const speedBoost = inCar && ownCar ? Math.abs(ownCar.speed) / CAR_MAX_SPEED * 3 : 0;
      const steer = inCar && ownCar ? ownCar.steer : 0;
      const roll = inCar && ownCar ? -steer * (Math.abs(ownCar.speed) / CAR_MAX_SPEED) * 0.06 : 0;
      updateCamera(camera, camSmX + shakeX, camSmZ + shakeZ, input.yaw, camDist + speedBoost, input.aiming && document.pointerLockElement !== null, dt, camColliders, roll);
    }
    avatars.update(dt);
    effects.update(me ?? undefined, ownCar ? Math.abs(ownCar.speed) : 0);
    // следы шин по всем машинам: падение скорости >8 между кадрами — резкое торможение
    (current.state.cars as any).forEach((car: any, id: string) => {
      const last = lastCarSpeeds.get(id) ?? Math.abs(car.speed);
      if (last - Math.abs(car.speed) > 8) {
        effects.addSkidmark(car.x, car.z, car.rotY);
        // чужой визг слышим только вблизи (свой уже сработал выше по down)
        if (me && dist2(car.x, car.z, me.x, me.z) < 30 * 30) effects.skid();
      }
      lastCarSpeeds.set(id, Math.abs(car.speed));
    });
    // машина убрана из стейта — чистим, чтобы map не росла
    for (const id of [...lastCarSpeeds.keys()]) if (!(current.state.cars as any).has(id)) lastCarSpeeds.delete(id);
    fx.update(performance.now());
    pickups.update();
    ui.update();
    tablist.update();
    if (me) {
      if (me.mode === 'car') lastCarId = me.carId;
      const markers: MapMarker[] = [];
      if (me.mode !== 'car' && lastCarId) {
        const car = (current.state.cars as any).get(lastCarId);
        if (!car || (car.driverId && car.driverId !== current.sessionId)) lastCarId = '';
        else markers.push({ x: car.x, z: car.z, kind: 'car' });
      }
      if (me.cargo) {
        // переменная названа target, а не t: t — это импорт i18n
        const target = map.deliveryTargets.find(dt => dt.id === me.deliveryTarget);
        if (target) markers.push({ x: target.x, z: target.z, kind: 'target' });
      }
      const nowSrv = avatars.serverNow();
      (current.state.players as any).forEach((p: any, id: string) => {
        if (id === current.sessionId || p.role === 'zombie') return; // себя рисует стрелка, зомби — шум
        markers.push({
          x: p.x, z: p.z, kind: 'player',
          color: p.wantedUntil > nowSrv ? '#ff3333' : p.role === 'cop' ? '#4477ff' : '#ffffff',
        });
      });
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
  });

  // онбординг — один раз на браузер, три подсказки с паузами
  if (!localStorage.getItem('seenIntro')) {
    localStorage.setItem('seenIntro', '1');
    (['hint.move', 'hint.car', 'hint.wanted'] as const).forEach((key, i) => {
      setTimeout(() => ui.showToast(t(key)), 1000 + i * 4000);
    });
  }
}

document.getElementById('joinGo')!.addEventListener('click', () => void start());
passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void start(); });
