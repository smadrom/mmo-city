import { MAP_HALF, FULLMAP_MAX_ZOOM } from '@mmo/shared';
import type { CityMapRenderer, MapMarker } from './minimap.js';
import { isTypingTarget, type InputController } from './input.js';

// Полноэкранная карта (M): тот же статичный слой, зум колёсиком, пан drag'ом.
export class Fullmap {
  isOpen = false;
  onOpen?: () => void; // main.ts подписывает: закрыть телефон
  private canvas: HTMLCanvasElement;
  private zoom = 1;
  private panX = 0;
  private panZ = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private self: { x: number; z: number; rotY: number } | null = null;
  private markers: MapMarker[] = [];

  constructor(private renderer: CityMapRenderer, private input: InputController) {
    this.canvas = document.getElementById('fullmap') as HTMLCanvasElement;
    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTypingTarget()) return;
      if (e.code === 'KeyM') this.isOpen ? this.close() : this.open();
      else if (e.code === 'Escape' && this.isOpen) this.close();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.min(FULLMAP_MAX_ZOOM, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    }, { passive: false });
    // ресайз окна с открытой картой: пересчитать canvas, иначе пропорции едут
    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.renderNow();
    });
    this.canvas.addEventListener('mousedown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; });
    // тач: один палец — пан, два — pinch-зум
    let pinchDist = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.dragging = true;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.dragging = false;
        pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault(); // не скроллить страницу под картой
      if (e.touches.length === 1 && this.dragging) {
        const fit = Math.min(this.canvas.width, this.canvas.height) / (MAP_HALF * 2);
        this.panX -= (e.touches[0].clientX - this.lastX) / (fit * this.zoom);
        this.panZ -= (e.touches[0].clientY - this.lastY) / (fit * this.zoom);
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2 && pinchDist > 0) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.zoom = Math.min(FULLMAP_MAX_ZOOM, Math.max(1, this.zoom * (d / pinchDist)));
        pinchDist = d;
      }
      this.renderNow();
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => { this.dragging = false; pinchDist = 0; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.isOpen) return;
      const fit = Math.min(this.canvas.width, this.canvas.height) / (MAP_HALF * 2);
      this.panX -= (e.clientX - this.lastX) / (fit * this.zoom);
      this.panZ -= (e.clientY - this.lastY) / (fit * this.zoom);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.renderNow();
    });
  }

  open(): void {
    this.isOpen = true;
    this.onOpen?.();
    document.exitPointerLock();
    this.input.setBlocked(true);
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // стартовый вид — на игрока (пан от позиции, зум 1.5)
    if (this.self) { this.panX = this.self.x; this.panZ = this.self.z; }
    this.zoom = 1.5;
    this.canvas.classList.remove('hidden');
    this.renderNow();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.setBlocked(false);
    this.canvas.classList.add('hidden');
  }

  render(self: { x: number; z: number; rotY: number }, markers: MapMarker[]): void {
    this.self = self;
    this.markers = markers;
    if (this.isOpen) this.renderNow();
  }

  private renderNow(): void {
    if (!this.self) return;
    this.renderer.renderFull(this.canvas, this.self, this.markers, { panX: this.panX, panZ: this.panZ, zoom: this.zoom });
  }
}
