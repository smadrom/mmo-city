import * as THREE from 'three';
import { getStateCallbacks, type Room } from 'colyseus.js';
import { t } from './i18n/index.js';

// функция, а не module-level объект: язык применяется в момент вызова
function kindLabel(kind: string): string {
  return t(`weapon.${kind}`);
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 4, 256, 56);
  ctx.font = 'bold 40px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 32, 240);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.y = 1.6;
  return sprite;
}

function makeBody(kind: string): THREE.Mesh {
  let geo: THREE.BoxGeometry;
  let mat: THREE.Material;
  if (kind === 'bat') {
    geo = new THREE.BoxGeometry(0.15, 0.15, 0.9);
    mat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  } else if (kind === 'pistol') {
    geo = new THREE.BoxGeometry(0.15, 0.2, 0.4);
    mat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  } else if (kind === 'rifle') {
    geo = new THREE.BoxGeometry(0.15, 0.2, 1.1);
    mat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  } else if (kind === 'cash') {
    geo = new THREE.BoxGeometry(0.4, 0.12, 0.25);
    mat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
  } else { // ammo
    geo = new THREE.BoxGeometry(0.35, 0.25, 0.35);
    mat = new THREE.MeshLambertMaterial({ color: 0x33aa33 });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.6;
  return mesh;
}

interface PickupEntry { group: THREE.Group; kind: string; phase: number }

export class Pickups {
  private items = new Map<string, PickupEntry>();

  constructor(private scene: THREE.Scene, private room: Room) {
    const $ = getStateCallbacks(room);
    $(room.state).pickups.onAdd((pk: any, id: string) => {
      const group = new THREE.Group();
      group.position.set(pk.x, 0, pk.z);
      this.scene.add(group);
      const entry: PickupEntry = { group, kind: '', phase: Math.random() * Math.PI * 2 };
      this.rebuild(entry, pk);
      this.items.set(id, entry);
    });
    $(room.state).pickups.onRemove((_pk: any, id: string) => {
      const entry = this.items.get(id);
      if (entry) {
        this.dispose(entry);
        this.scene.remove(entry.group);
        this.items.delete(id);
      }
    });
  }

  private dispose(entry: PickupEntry): void {
    entry.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m) {
        (m as unknown as THREE.SpriteMaterial).map?.dispose();
        m.dispose();
      }
    });
  }

  private rebuild(entry: PickupEntry, pk: any): void {
    this.dispose(entry);
    entry.group.clear();
    entry.group.add(makeBody(pk.kind));
    entry.group.add(makeLabel(pk.kind === 'cash' ? `${pk.amount}$` : kindLabel(pk.kind)));
    entry.kind = pk.kind;
  }

  update(): void {
    const now = performance.now();
    this.items.forEach((entry, id) => {
      const pk = (this.room.state.pickups as any).get(id);
      if (!pk) return;
      if (pk.kind !== entry.kind) this.rebuild(entry, pk); // вид сменился при респауне
      entry.group.visible = pk.active;
      entry.group.rotation.y = now / 1000 + entry.phase;
      entry.group.position.y = 0.1 + Math.sin(now / 400 + entry.phase) * 0.1;
    });
  }
}
