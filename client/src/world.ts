import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCityMap, ROADS, ROAD_WIDTH, MAP_HALF, type CityMap, type Point, type BuildingDef } from '@mmo/shared';
import { t } from './i18n/index.js';

export interface WorldFx { update(now: number): void }
const DAY_MS = 10 * 60_000; // полный цикл день/ночь

// t() вызывается при построении мира (после выбора языка на экране входа),
// а не при импорте модуля — иначе подписи застрянут на языке загрузки страницы
function kindLabel(kind: BuildingDef['kind']): string {
  return t(`world.${kind}`);
}

function makeTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 14, 512, 100);
  ctx.font = 'bold 56px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 64, 480);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  sprite.scale.set(10, 2.5, 1);
  return sprite;
}

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

export function buildWorld(scene: THREE.Scene): { map: CityMap; fx: WorldFx } {
  const map = createCityMap();

  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 200, 600);

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
  const amb = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(amb);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
    new THREE.MeshLambertMaterial({ color: 0x4a7c3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const lineMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const SIDEWALK_WIDTH = 3;
  const DASH_LENGTH = 3;
  const DASH_STEP = 6;
  const dashGeos: THREE.BufferGeometry[] = [];
  for (const at of ROADS) {
    for (const vertical of [true, false]) {
      const geo = new THREE.PlaneGeometry(
        vertical ? ROAD_WIDTH : MAP_HALF * 2,
        vertical ? MAP_HALF * 2 : ROAD_WIDTH,
      );
      const road = new THREE.Mesh(geo, roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(vertical ? at : 0, 0.01, vertical ? 0 : at);
      scene.add(road);

      for (const side of [-1, 1]) {
        const off = side * (ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2);
        const sidewalk = new THREE.Mesh(
          new THREE.PlaneGeometry(
            vertical ? SIDEWALK_WIDTH : MAP_HALF * 2,
            vertical ? MAP_HALF * 2 : SIDEWALK_WIDTH,
          ),
          sidewalkMat,
        );
        sidewalk.rotation.x = -Math.PI / 2;
        sidewalk.position.set(vertical ? at + off : 0, 0.02, vertical ? 0 : at + off);
        scene.add(sidewalk);
      }

      for (let d = -MAP_HALF + DASH_STEP; d <= MAP_HALF - DASH_STEP; d += DASH_STEP) {
        const g = new THREE.BoxGeometry(vertical ? 0.4 : DASH_LENGTH, 0.02, vertical ? DASH_LENGTH : 0.4);
        g.translate(vertical ? at : d, 0.03, vertical ? d : at);
        dashGeos.push(g);
      }
    }
  }

  // сотни штрихов — одним мешем: ~400 draw calls экономии (мобилка)
  const dashes = mergeGeometries(dashGeos, false);
  if (dashes) scene.add(new THREE.Mesh(dashes, lineMat));

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

  const doorMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
  for (const a of map.apartments) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.3), doorMat);
    m.position.set(a.x, 1.25, a.z);
    scene.add(m);
  }

  const mark = (p: Point, color: number) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 1.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.position.set(p.x, 0.8, p.z);
    scene.add(m);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.05, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    ring.position.set(p.x, 0.03, p.z);
    scene.add(ring);
  };
  mark(map.warehouse, 0xff8800);
  mark(map.gunShop, 0xcc44ff);
  for (const t of map.deliveryTargets) mark(t, 0x00cccc);
  mark(map.hospitalDoor, 0xffffff);
  mark(map.policeDoor, 0x2244ff);
  for (const a of map.apartments) mark(a, 0xffcc00);

  const poi = (p: Point, text: string) => {
    const label = makeTextSprite(text);
    label.position.set(p.x, 6, p.z);
    scene.add(label);
  };
  poi(map.gunShop, t('world.gunshop'));
  for (const t0 of map.deliveryTargets) poi(t0, t(`target.${t0.id}`));

  // забор вокруг безопасных зон, ворота — южная грань (к дороге)
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const fenceGeos: THREE.BufferGeometry[] = [];
  for (const z of map.safeZones) {
    const minX = z.x - z.w / 2;
    const maxX = z.x + z.w / 2;
    const minZ = z.z - z.d / 2;
    const maxZ = z.z + z.d / 2;
    const seg = (x: number, zz: number, w: number, d: number) => {
      const g = new THREE.BoxGeometry(w, 1.2, d);
      g.translate(x, 0.6, zz);
      fenceGeos.push(g);
    };
    for (let x = minX + 1; x <= maxX - 1; x += 2) {
      seg(x, minZ, 2, 0.15);
      if (Math.abs(x - z.x) > 3) seg(x, maxZ, 2, 0.15); // ворота
    }
    for (let zz = minZ + 1; zz <= maxZ - 1; zz += 2) {
      seg(minX, zz, 0.15, 2);
      seg(maxX, zz, 0.15, 2);
    }
    const zoneLabel = makeTextSprite(t('world.safezone'));
    zoneLabel.position.set(z.x, 4, z.z);
    scene.add(zoneLabel);
  }

  const fence = mergeGeometries(fenceGeos, false);
  if (fence) scene.add(new THREE.Mesh(fence, fenceMat));

  // кладбище у первой точки спавна зомби
  const grave = map.zombieSpawns[0];
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshLambertMaterial({ color: 0x2f2f26 }),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(grave.x, 0.04, grave.z);
  scene.add(yard);
  const graveLabel = makeTextSprite(t('world.graveyard'));
  graveLabel.position.set(grave.x, 5, grave.z);
  scene.add(graveLabel);

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

  return { map, fx };
}
