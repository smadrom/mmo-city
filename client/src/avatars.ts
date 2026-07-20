import * as THREE from 'three';
import { WEAPONS, MAX_HP, type WeaponKind } from '@mmo/shared';
import { getStateCallbacks, type Room } from 'colyseus.js';

interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  marker: THREE.Mesh;
  gun: THREE.Mesh;
  fistL: THREE.Mesh;
  fistR: THREE.Mesh;
  bat: THREE.Mesh;
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  flash: THREE.Sprite;
  swingAt: number;
  recoilAt: number;
}

// интерполяция: рендерим чужих с задержкой INTERP_DELAY_MS по буферу снапшотов
const INTERP_DELAY_MS = 120;
const SNAP_BUFFER_MS = 1000;

interface Snap { t: number; x: number; z: number; rotY: number }

function lerpAngle(a: number, b: number, alpha: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * alpha;
}

function pushSnap(buf: Snap[], t: number, x: number, z: number, rotY: number): void {
  const last = buf[buf.length - 1];
  if (last && last.x === x && last.z === z && last.rotY === rotY) return;
  buf.push({ t, x, z, rotY });
  while (buf.length > 2 && buf[0].t < t - SNAP_BUFFER_MS) buf.shift();
}

function sampleSnap(buf: Snap[], rt: number): Snap | null {
  if (buf.length === 0) return null;
  if (rt <= buf[0].t) return buf[0];
  const last = buf[buf.length - 1];
  if (rt >= last.t) return last;
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (a.t <= rt) {
      const d = b.t - a.t;
      const alpha = d > 0 ? (rt - a.t) / d : 1; // равные t — берём более свежий снап, без 0/0
      return { t: rt, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, rotY: lerpAngle(a.rotY, b.rotY, alpha) };
    }
  }
  return buf[0];
}

function makeNameLabel(name: string, role: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const roleRu = role === 'cop' ? 'Полицейский' : role === 'zombie' ? 'Зомби' : 'Гражданин';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(3, 6, 250, 84);
  ctx.font = 'bold 32px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 32, 236);
  ctx.font = '26px sans-serif';
  ctx.fillStyle = role === 'cop' ? '#77aaff' : role === 'zombie' ? '#77cc66' : '#bbbbbb';
  ctx.fillText(roleRu, 128, 68, 236);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sprite.scale.set(2.5, 0.94, 1);
  sprite.position.y = 2.55;
  return sprite;
}

function makePlayerMesh(name: string, role: string): PlayerMesh {
  const group = new THREE.Group();
  group.add(makeNameLabel(name, role));
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x888888 }),
  );
  body.position.y = 0.9;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    new THREE.MeshLambertMaterial({ color: 0xffcc99 }),
  );
  head.position.y = 1.9;
  group.add(head);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.8, 4),
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  );
  marker.position.y = 2.8;
  marker.visible = false;
  group.add(marker);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x222222 }),
  );
  gun.position.set(0.45, 1.2, -0.35);
  gun.visible = false;
  group.add(gun);
  const fistGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const fistMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const fistL = new THREE.Mesh(fistGeo, fistMat);
  fistL.position.set(-0.55, 1.2, -0.15);
  group.add(fistL);
  const fistR = new THREE.Mesh(fistGeo, fistMat);
  fistR.position.set(0.55, 1.2, -0.15);
  group.add(fistR);
  const bat = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
  );
  bat.position.set(0.55, 1.2, -0.2);
  bat.visible = false;
  group.add(bat);
  const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x222222 }));
  hpBg.scale.set(1.2, 0.12, 1);
  hpBg.position.y = 2.12;
  group.add(hpBg);
  const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x33cc33 }));
  hpFg.scale.set(1.2, 0.12, 1);
  hpFg.position.y = 2.13;
  group.add(hpFg);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffee88, transparent: true }));
  flash.scale.set(0.5, 0.5, 1);
  flash.position.set(0, 0, -0.45); // у дула (дочерний к gun)
  flash.visible = false;
  gun.add(flash);
  return { group, body, head, marker, gun, fistL, fistR, bat, hpBg, hpFg, flash, swingAt: 0, recoilAt: 0 };
}

interface CarMesh { group: THREE.Group; wheelFL: THREE.Group; wheelFR: THREE.Group; wheels: THREE.Mesh[] }

const WHEEL_AXIS_Y = new THREE.Vector3(0, 1, 0);

function makeCarMesh(): CarMesh {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.7, 4),
    new THREE.MeshLambertMaterial({ color: 0xcc3333 }),
  );
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.6, 1.8),
    new THREE.MeshLambertMaterial({ color: 0x333344 }),
  );
  cabin.position.set(0, 1.15, -0.2);
  group.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const spokeMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const wheels: THREE.Mesh[] = [];
  let wheelFL = new THREE.Group();
  let wheelFR = new THREE.Group();
  for (const [wx, wz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]] as const) {
    const mount = new THREE.Group();
    mount.position.set(wx, 0.35, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.1), spokeMat); // чтобы вращение читалось
    wheel.add(spoke);
    mount.add(wheel);
    group.add(mount);
    wheels.push(wheel);
    if (wz < 0 && wx < 0) wheelFL = mount; // перед — отрицательный z (нос машины)
    if (wz < 0 && wx > 0) wheelFR = mount;
  }
  return { group, wheelFL, wheelFR, wheels };
}

export class Avatars {
  // смещение serverTime − Date.now(); рекалибруется EMA на каждом патче,
  // чтобы не уплывать при дрейфе часов в долгой сессии
  private serverOffset: number;
  // предсказанная позиция себя (пешком); null — едем по серверному state
  selfPos: { x: number; z: number } | null = null;
  private players = new Map<string, PlayerMesh>();
  private cars = new Map<string, CarMesh>();
  private playerSnaps = new Map<string, Snap[]>();
  private carSnaps = new Map<string, Snap[]>();

  constructor(private scene: THREE.Scene, private room: Room) {
    this.serverOffset = (room.state as any).serverTime - Date.now();
    room.onStateChange(() => {
      const st = (room.state as any).serverTime as number;
      if (!st) return; // serverTime ещё не проставлен
      const sample = st - Date.now();
      this.serverOffset += (sample - this.serverOffset) * 0.05;
    });

    // colyseus.js 0.16: колбеки состояния регистрируются через getStateCallbacks
    const $ = getStateCallbacks(room);

    $(room.state).players.onAdd((p: any, id: string) => {
      const mesh = makePlayerMesh(p.name ?? 'игрок', p.role ?? 'citizen');
      mesh.group.position.set(p.x, 0, p.z); // сразу на месте, без «прилёта» из (0,0,0)
      mesh.group.rotation.y = p.rotY;
      this.players.set(id, mesh);
      this.playerSnaps.set(id, []);
      scene.add(mesh.group);
    });
    $(room.state).players.onRemove((_p: any, id: string) => {
      const mesh = this.players.get(id);
      if (mesh) {
        scene.remove(mesh.group);
        this.players.delete(id);
        this.playerSnaps.delete(id);
      }
    });
    $(room.state).cars.onAdd((c: any, id: string) => {
      const mesh = makeCarMesh();
      mesh.group.position.set(c.x, 0, c.z);
      mesh.group.rotation.y = c.rotY;
      this.cars.set(id, mesh);
      this.carSnaps.set(id, []);
      scene.add(mesh.group);
    });
    $(room.state).cars.onRemove((_c: any, id: string) => {
      const mesh = this.cars.get(id);
      if (mesh) {
        scene.remove(mesh.group);
        this.cars.delete(id);
        this.carSnaps.delete(id);
      }
    });
  }

  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  // текущая отрисованная (интерполированная) позиция меша игрока — для tracer'ов
  meshPos(id: string): { x: number; z: number } | null {
    const mesh = this.players.get(id);
    if (!mesh) return null;
    return { x: mesh.group.position.x, z: mesh.group.position.z };
  }

  playSwing(id: string): void {
    const mesh = this.players.get(id);
    if (mesh) mesh.swingAt = performance.now();
  }

  playRecoil(id: string): void {
    const mesh = this.players.get(id);
    if (mesh) mesh.recoilAt = performance.now();
  }

  update(dt: number): void {
    const nowServer = this.serverNow();
    const rt = nowServer - INTERP_DELAY_MS;
    // красные маркеры розыска над головами показываем только копам
    const iAmCop = (this.room.state.players as any).get(this.room.sessionId)?.role === 'cop';

    this.players.forEach((mesh, id) => {
      const p = (this.room.state.players as any).get(id);
      if (!p) return;
      if (id === this.room.sessionId) {
        // себя не интерполируем — иначе управление ватное; пешком — предсказание
        mesh.group.position.set(this.selfPos?.x ?? p.x, 0, this.selfPos?.z ?? p.z);
        mesh.group.rotation.y = p.rotY;
      } else {
        const buf = this.playerSnaps.get(id)!;
        pushSnap(buf, nowServer, p.x, p.z, p.rotY);
        const s = sampleSnap(buf, rt);
        if (s) {
          mesh.group.position.set(s.x, 0, s.z);
          mesh.group.rotation.y = s.rotY;
        }
      }
      (mesh.body.material as THREE.MeshLambertMaterial).color.set(p.role === 'cop' ? 0x2244ff : p.role === 'zombie' ? 0x33aa33 : 0x888888);
      mesh.marker.visible = iAmCop && p.wantedUntil > nowServer;
      mesh.group.visible = p.mode !== 'dead';
      // в машине прячем только тело — табличка остаётся над машиной
      const onFoot = p.mode !== 'car';
      mesh.body.visible = onFoot;
      mesh.head.visible = onFoot;
      // кулаки — только пешим и с пустыми руками
      const handsFree = onFoot && !p.weapon;
      mesh.fistL.visible = handsFree;
      mesh.fistR.visible = handsFree;
      const w = p.weapon && Object.hasOwn(WEAPONS, p.weapon) ? WEAPONS[p.weapon as WeaponKind] : null;
      mesh.gun.visible = onFoot && w?.ranged === true;
      mesh.bat.visible = onFoot && p.weapon === 'bat';
      // HP-полоска — над чужими живыми пешеходами (у себя HP в HUD)
      const showHp = id !== this.room.sessionId && p.mode === 'foot';
      mesh.hpBg.visible = showHp;
      mesh.hpFg.visible = showHp;
      if (showHp) {
        const k = Math.max(0, Math.min(1, p.hp / MAX_HP));
        mesh.hpFg.scale.x = 1.2 * k;
        mesh.hpFg.position.x = -1.2 * (1 - k) / 2; // левый край зафиксирован
        (mesh.hpFg.material as THREE.SpriteMaterial).color.set(k > 0.5 ? 0x33cc33 : k > 0.25 ? 0xddaa22 : 0xcc2222);
      }
      // замах (150 мс): правая рука/бита вперёд-назад
      const st = (performance.now() - mesh.swingAt) / 150;
      const swingZ = st < 1 ? Math.sin(st * Math.PI) * 0.6 : 0;
      mesh.fistR.position.z = -0.15 - swingZ;
      mesh.bat.position.z = -0.2 - swingZ;
      // отдача (80 мс): ствол назад + вспышка у дула
      const rc = (performance.now() - mesh.recoilAt) / 80;
      mesh.gun.position.z = -0.35 + (rc < 1 ? Math.sin(rc * Math.PI) * 0.15 : 0);
      mesh.flash.visible = rc < 0.75;
    });

    this.cars.forEach((mesh, id) => {
      const c = (this.room.state.cars as any).get(id);
      if (!c) return;
      mesh.wheelFL.rotation.y = c.steer * 0.5;
      mesh.wheelFR.rotation.y = c.steer * 0.5;
      const angle = (c.speed * dt) / 0.35; // r колеса 0.35
      for (const w of mesh.wheels) w.rotateOnAxis(WHEEL_AXIS_Y, angle);
      if (c.driverId === this.room.sessionId) {
        mesh.group.position.set(c.x, 0, c.z);
        mesh.group.rotation.y = c.rotY;
      } else {
        const buf = this.carSnaps.get(id)!;
        pushSnap(buf, nowServer, c.x, c.z, c.rotY);
        const s = sampleSnap(buf, rt);
        if (s) {
          mesh.group.position.set(s.x, 0, s.z);
          mesh.group.rotation.y = s.rotY;
        }
      }
    });
  }
}
