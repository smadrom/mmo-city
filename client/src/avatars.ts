import * as THREE from 'three';
import { getStateCallbacks, type Room } from 'colyseus.js';

interface PlayerMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  marker: THREE.Mesh;
}

function makePlayerMesh(): PlayerMesh {
  const group = new THREE.Group();
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
  return { group, body, marker };
}

function makeCarMesh(): THREE.Group {
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
  for (const [wx, wz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]] as const) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.35, wz);
    group.add(wheel);
  }
  return group;
}

export class Avatars {
  readonly serverOffset: number;
  private players = new Map<string, PlayerMesh>();
  private cars = new Map<string, THREE.Group>();

  constructor(private scene: THREE.Scene, private room: Room) {
    this.serverOffset = (room.state as any).serverTime - Date.now();

    // colyseus.js 0.16: колбеки состояния регистрируются через getStateCallbacks
    const $ = getStateCallbacks(room);

    $(room.state).players.onAdd((_p: any, id: string) => {
      const mesh = makePlayerMesh();
      this.players.set(id, mesh);
      scene.add(mesh.group);
    });
    $(room.state).players.onRemove((_p: any, id: string) => {
      const mesh = this.players.get(id);
      if (mesh) {
        scene.remove(mesh.group);
        this.players.delete(id);
      }
    });
    $(room.state).cars.onAdd((_c: any, id: string) => {
      const mesh = makeCarMesh();
      this.cars.set(id, mesh);
      scene.add(mesh);
    });
    $(room.state).cars.onRemove((_c: any, id: string) => {
      const mesh = this.cars.get(id);
      if (mesh) {
        scene.remove(mesh);
        this.cars.delete(id);
      }
    });
  }

  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 10);
    const nowServer = this.serverNow();

    this.players.forEach((mesh, id) => {
      const p = (this.room.state.players as any).get(id);
      if (!p) return;
      mesh.group.position.lerp(new THREE.Vector3(p.x, 0, p.z), k);
      mesh.group.rotation.y = p.rotY;
      (mesh.body.material as THREE.MeshLambertMaterial).color.set(p.role === 'cop' ? 0x2244ff : 0x888888);
      mesh.marker.visible = p.wantedUntil > nowServer;
      mesh.group.visible = p.mode !== 'car' && p.mode !== 'dead';
    });

    this.cars.forEach((mesh, id) => {
      const c = (this.room.state.cars as any).get(id);
      if (!c) return;
      mesh.position.lerp(new THREE.Vector3(c.x, 0, c.z), k);
      mesh.rotation.y = c.rotY;
    });
  }
}
