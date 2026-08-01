import {
  MAP_HALF, ROADS, ROAD_WIDTH, MINIMAP_SIZE, MINIMAP_RADIUS,
  type CityMap,
} from '@mmo/shared';
import { t } from './i18n/index.js';

export interface MapMarker { x: number; z: number; kind: 'car' | 'target' }
export interface Poi { x: number; z: number; label: string }

const KIND_COLORS: Record<string, string> = {
  hospital: '#dddddd', police: '#4477dd', warehouse: '#a06a30', house: '#666677',
};

// Рендерер карты: статичный слой города рисуется один раз (1 px = 1 м),
// дальше mini/full режимы только копируют его с нужным трансформом и кладут метки.
export class CityMapRenderer {
  readonly pois: Poi[] = [];
  private staticLayer: HTMLCanvasElement;

  constructor(map: CityMap) {
    const size = MAP_HALF * 2;
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = this.staticLayer.height = size;
    const ctx = this.staticLayer.getContext('2d')!;
    ctx.fillStyle = '#1e3a1e'; // земля
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#3d3d3d'; // дороги
    for (const r of ROADS) {
      ctx.fillRect(r - ROAD_WIDTH / 2 + MAP_HALF, 0, ROAD_WIDTH, size);
      ctx.fillRect(0, r - ROAD_WIDTH / 2 + MAP_HALF, size, ROAD_WIDTH);
    }
    for (const b of map.buildings) {
      ctx.fillStyle = KIND_COLORS[b.kind] ?? KIND_COLORS.house;
      ctx.fillRect(b.x - b.w / 2 + MAP_HALF, b.z - b.d / 2 + MAP_HALF, b.w, b.d);
    }
    this.pois = [
      { x: map.hospitalDoor.x, z: map.hospitalDoor.z, label: t('world.hospital') },
      { x: map.policeDoor.x, z: map.policeDoor.z, label: t('world.police') },
      { x: map.warehouse.x, z: map.warehouse.z, label: t('world.warehouse') },
      { x: map.gunShop.x, z: map.gunShop.z, label: t('world.gunshop') },
      ...map.deliveryTargets.map(t0 => ({ x: t0.x, z: t0.z, label: t(`target.${t0.id}`) })),
    ];
  }

  renderMinimap(canvas: HTMLCanvasElement, self: { x: number; z: number; rotY: number }, markers: MapMarker[]): void {
    const S = MINIMAP_SIZE;
    const scale = (S / 2) / MINIMAP_RADIUS; // px на метр
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, S, S);
    // мир: игрок — в центре круга (статика в координатах x+MAP_HALF)
    ctx.translate(S / 2, S / 2);
    ctx.scale(scale, scale);
    ctx.drawImage(this.staticLayer, -(self.x + MAP_HALF), -(self.z + MAP_HALF));
    ctx.restore();
    // метки в экранных координатах (за кругом не рисуем)
    for (const m of [...this.pois.map(p => ({ ...p, kind: 'poi' as const })), ...markers]) {
      const sx = S / 2 + (m.x - self.x) * scale;
      const sz = S / 2 + (m.z - self.z) * scale;
      if (Math.hypot(sx - S / 2, sz - S / 2) > S / 2 - 5) continue;
      ctx.fillStyle = m.kind === 'car' ? '#ffcc00' : m.kind === 'target' ? '#ff4444' : '#66aaff';
      ctx.beginPath();
      ctx.arc(sx, sz, m.kind === 'poi' ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // стрелка игрока: вверх по -z при rotY=0 → rotate(-rotY)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-self.rotY);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  renderFull(
    canvas: HTMLCanvasElement,
    self: { x: number; z: number; rotY: number },
    markers: MapMarker[],
    view: { panX: number; panZ: number; zoom: number },
  ): void {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const fit = Math.min(w, h) / (MAP_HALF * 2);
    const scale = fit * view.zoom;
    const toX = (x: number) => w / 2 + (x - view.panX) * scale;
    const toY = (z: number) => h / 2 + (z - view.panZ) * scale;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    const size = MAP_HALF * 2;
    ctx.drawImage(this.staticLayer, toX(-MAP_HALF), toY(-MAP_HALF), size * scale, size * scale);
    // POI с подписями
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    for (const p of this.pois) {
      ctx.fillStyle = '#66aaff';
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.z), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.label, toX(p.x), toY(p.z) - 8);
    }
    for (const m of markers) {
      ctx.fillStyle = m.kind === 'car' ? '#ffcc00' : '#ff4444';
      ctx.beginPath();
      ctx.arc(toX(m.x), toY(m.z), 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // стрелка игрока
    ctx.save();
    ctx.translate(toX(self.x), toY(self.z));
    ctx.rotate(-self.rotY);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
