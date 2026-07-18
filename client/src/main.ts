import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect } from './net.js';
import type { Room } from 'colyseus.js';
import type { CityMap } from '@mmo/shared';

const joinScreen = document.getElementById('join')!;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;

async function start(role: string): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Введи ник';
    return;
  }
  let room: Room;
  try {
    room = await connect(name, role);
  } catch {
    joinError.textContent = 'Не удалось подключиться (сервер полон или недоступен)';
    return;
  }
  joinScreen.style.display = 'none';
  document.getElementById('hud')!.classList.remove('hidden');
  bootGame(room);
}

function bootGame(room: Room): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
  const map: CityMap = buildWorld(scene);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // avatars, input, ui подключаются в задачах 14–15:
  // const avatars = new Avatars(scene, room);
  // const input = new InputController(room, renderer.domElement);
  // const ui = new UI(room, map);
  void map;

  const me = () => room.state.players.get(room.sessionId) as any;
  renderer.setAnimationLoop(() => {
    const p = me();
    if (p) {
      camera.position.set(p.x, 30, p.z + 25);
      camera.lookAt(p.x, 0, p.z);
    }
    renderer.render(scene, camera);
  });
}

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
