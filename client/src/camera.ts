import * as THREE from 'three';
import type { Room } from 'colyseus.js';

const CAM_DIST = 7;
const CAM_HEIGHT = 4;

export function updateCamera(camera: THREE.PerspectiveCamera, room: Room, yaw: number): void {
  const me = (room.state.players as any).get(room.sessionId);
  if (!me) return;
  camera.position.set(
    me.x + Math.sin(yaw) * CAM_DIST,
    CAM_HEIGHT,
    me.z + Math.cos(yaw) * CAM_DIST,
  );
  camera.lookAt(me.x, 1.5, me.z);
}
