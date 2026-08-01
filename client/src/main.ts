import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect } from './net.js';
import { Avatars } from './avatars.js';
import { InputController, isTypingTarget } from './input.js';
import { Prediction } from './prediction.js';
import { updateCamera } from './camera.js';
import { UI } from './ui.js';
import { Effects } from './effects.js';
import { Pickups } from './pickups.js';
import { CityMapRenderer, type MapMarker } from './minimap.js';
import { Fullmap } from './fullmap.js';
import { Phone } from './phone.js';
import { Feed } from './feed.js';
import type { Room } from 'colyseus.js';
import { t, setLang, getLang, applyStatic } from './i18n/index.js';

// статика экрана входа — сразу на выбранном языке
applyStatic();

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
  // первый ROOM_STATE приходит отдельным сообщением после join, и в нём
  // serverTime ещё 0 (тики его обновят) — ждём живое значение, иначе
  // поля state undefined (падение в Avatars) и съезжают таймеры баннеров
  while (!room.state.serverTime) {
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
  }
  // consented leave клиент не шлёт — любой onLeave это потеря соединения.
  // Прозрачного реконнекта пока нет (бэклог) — перезагрузка на экран входа;
  // при повторном входе история чата запросится заново
  room.onLeave(() => location.reload());
  bootGame(room);
}

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // чёткость на Retina; кап 2 — перф
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const map = buildWorld(scene);
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  const ui = new UI(room, map, avatars, input);
  const effects = new Effects(scene, room, avatars);
  const pickups = new Pickups(scene, room);
  const mapRenderer = new CityMapRenderer(map);
  const fullmap = new Fullmap(mapRenderer, input);
  const phone = new Phone(room, map, input, (text) => ui.showToast(text), () => avatars.serverNow());
  room.onMessage('notice', (m: { code?: string; until?: number; text?: string }) => {
    if (m?.code === 'muted' && m.until) {
      const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
      ui.showToast(t('notice.muted', { time: new Date(m.until).toLocaleTimeString(locale) }));
    } else if (m?.text) ui.showToast(String(m.text)); // переходный формат до Task 15
  });
  const feed = new Feed();
  feed.bind(room);
  room.onMessage('delivered', (m: { reward: number }) => {
    ui.showToast(`+${m.reward}$`); // сумма числом — универсально для обоих языков
    effects.cashIn();
  });
  // effects создан раньше — его keydown переключает mute первым, здесь читаем уже новое значение
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget()) return; // не срабатываем при печати в чате/полях
    if (e.code === 'KeyN' && !e.repeat) ui.showToast(t(effects.muted ? 'sound.off' : 'sound.on'));
  });
  phone.onOpen = () => fullmap.close();
  fullmap.onOpen = () => phone.close();
  const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  let lastCarId = '';

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  const prediction = new Prediction();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    input.refresh();
    const me = (room.state.players as any).get(room.sessionId);
    if (me) {
      const predicted = prediction.update(dt, input.current, me.mode, me.x, me.z);
      avatars.selfPos = predicted ? { x: prediction.x, z: prediction.z } : null;
      updateCamera(camera, avatars.selfPos?.x ?? me.x, avatars.selfPos?.z ?? me.z, input.yaw);
    }
    avatars.update(dt);
    effects.update(me ?? undefined);
    pickups.update();
    ui.update();
    if (me) {
      if (me.mode === 'car') lastCarId = me.carId;
      const markers: MapMarker[] = [];
      if (me.mode !== 'car' && lastCarId) {
        const car = (room.state.cars as any).get(lastCarId);
        if (!car || (car.driverId && car.driverId !== room.sessionId)) lastCarId = '';
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
  });
}

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
