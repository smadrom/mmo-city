import * as THREE from 'three';

const CAM_DIST = 7;
const CAM_HEIGHT = 4;

// позицию передаёт main: предсказанная (пешком) или серверная (остальные режимы)
export function updateCamera(camera: THREE.PerspectiveCamera, x: number, z: number, yaw: number): void {
  camera.position.set(
    x + Math.sin(yaw) * CAM_DIST,
    CAM_HEIGHT,
    z + Math.cos(yaw) * CAM_DIST,
  );
  camera.lookAt(x, 1.5, z);
}
