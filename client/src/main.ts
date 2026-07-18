import * as THREE from 'three';
import { buildWorld } from './world.js';
import { connect } from './net.js';
import { Avatars } from './avatars.js';
import { InputController } from './input.js';
import { updateCamera } from './camera.js';
import { UI } from './ui.js';
import type { Room } from 'colyseus.js';

const joinScreen = document.getElementById('join')!;
const nameInput = document.getElementById('nameInput') as HTMLInputElement;
const joinError = document.getElementById('joinError')!;

let connecting = false;

async function start(role: string): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Введи ник';
    return;
  }
  if (connecting) return;
  connecting = true;
  let room: Room;
  try {
    room = await connect(name, role);
  } catch {
    connecting = false;
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
  const map = buildWorld(scene);
  const avatars = new Avatars(scene, room);
  const input = new InputController(room, renderer.domElement);
  const ui = new UI(room, map, avatars);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    avatars.update(dt);
    updateCamera(camera, room, input.yaw);
    ui.update();
    renderer.render(scene, camera);
  });
}

document.getElementById('joinCitizen')!.addEventListener('click', () => void start('citizen'));
document.getElementById('joinCop')!.addEventListener('click', () => void start('cop'));
