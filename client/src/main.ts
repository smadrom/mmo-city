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
import { TouchControls } from './touch.js';
import { t, setLang, getLang, applyStatic } from './i18n/index.js';
import type { Room } from 'colyseus.js';

applyStatic(); // статика экрана входа — сразу на языке пользователя

const joinScreen = document.getElementById('join')!;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;

document.getElementById('langRu')!.addEventListener('click', () => { setLang('ru'); applyStatic(); });
document.getElementById('langEn')!.addEventListener('click', () => { setLang('en'); applyStatic(); });

let connecting = false;

async function start(role: string): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = t('join.needName');
    return;
  }
  if (connecting) return;
  connecting = true;
  let room: Room;
  try {
    room = await connect(name, role);
  } catch (e: any) {
    connecting = false;
    const msg = String(e?.message ?? '');
    joinError.textContent = msg.includes('bad_token')
      ? t('join.badToken')
      : msg.includes('bad_version')
      ? t('join.badVersion')
      : msg.includes('banned')
      ? t('join.banned')
      : t('join.full');
    return;
  }
  joinScreen.style.display = 'none';
  document.getElementById('hud')!.classList.remove('hidden');
  try {
    // сервер может умереть между join и первым патчем — без таймаута был бы вечный чёрный экран
    await Promise.race([
      waitLiveState(room),
      new Promise((_, reject) => setTimeout(() => reject(new Error('state_timeout')), 8000)),
    ]);
  } catch {
    connecting = false;
    joinError.textContent = t('join.full');
    joinScreen.style.display = '';
    document.getElementById('hud')!.classList.add('hidden');
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
  const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  const prediction = new Prediction();
  const overlay = document.getElementById('reconnectOverlay')!;
  let current = room;
  let lastCarId = '';
  let camDist = 7;
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

  phone.onOpen = () => fullmap.close();
  fullmap.onOpen = () => phone.close();
  feed.bind(current);

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
      if (typeof m?.t === 'number' && m.t === pingT) rtt = Math.round(performance.now() - m.t);
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
        input.setRoom(fresh);
        prediction.reset();
        bindRoomMessages(fresh);
        overlay.classList.add('hidden');
        reconnecting = false;
        return;
      } catch { /* сервер ещё держит место или недоступен — следующая попытка */ }
    }
    location.reload(); // окно вышло — на экран входа (токен клейма ника в localStorage)
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
    if (me) {
      const predicted = prediction.update(dt, input.current, me.mode, me.x, me.z);
      avatars.selfPos = predicted ? { x: prediction.x, z: prediction.z } : null;
      updateCamera(camera, avatars.selfPos?.x ?? me.x, avatars.selfPos?.z ?? me.z, input.yaw, camDist, input.aiming && document.pointerLockElement !== null, dt, camColliders);
    }
    avatars.update(dt);
    effects.update(me ?? undefined);
    fx.update(performance.now());
    pickups.update();
    ui.update();
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

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
