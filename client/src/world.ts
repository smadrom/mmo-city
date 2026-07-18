import * as THREE from 'three';
import { createCityMap, ROADS, ROAD_WIDTH, MAP_HALF, type CityMap, type Point } from '@mmo/shared';

export function buildWorld(scene: THREE.Scene): CityMap {
  const map = createCityMap();

  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 200, 600);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(100, 200, 50);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2),
    new THREE.MeshLambertMaterial({ color: 0x4a7c3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const lineMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const SIDEWALK_WIDTH = 3;
  const DASH_LENGTH = 3;
  const DASH_STEP = 6;
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
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(vertical ? 0.4 : DASH_LENGTH, 0.02, vertical ? DASH_LENGTH : 0.4),
          lineMat,
        );
        dash.position.set(vertical ? at : d, 0.03, vertical ? d : at);
        scene.add(dash);
      }
    }
  }

  for (const b of map.buildings) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      new THREE.MeshLambertMaterial({ color: b.color }),
    );
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
  }

  const doorMat = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
  for (const a of map.apartments) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.3), doorMat);
    m.position.set(a.x, 1.25, a.z);
    scene.add(m);
  }

  const mark = (p: Point, color: number, size = 3) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(size, size, 0.2, 24),
      new THREE.MeshLambertMaterial({ color }),
    );
    m.position.set(p.x, 0.1, p.z);
    scene.add(m);
  };
  mark(map.warehouse, 0xff8800);
  for (const t of map.deliveryTargets) mark(t, 0x00cccc);
  mark(map.hospitalDoor, 0xffffff, 2);
  mark(map.policeDoor, 0x2244ff, 2);

  return map;
}
