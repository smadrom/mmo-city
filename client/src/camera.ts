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
