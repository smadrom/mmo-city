import * as THREE from 'three';
import type { Room } from 'colyseus.js';

const TRACER_MS = 80;
const VIGNETTE_MS = 150;

interface Tracer { line: THREE.Line; bornAt: number }

export class Effects {
  private tracers: Tracer[] = [];
  private vignette = document.getElementById('vignette')!;
  private vignetteTimer = 0;
  private audio: AudioContext | null = null;

  constructor(private scene: THREE.Scene, room: Room) {
    room.onMessage('shot', (msg: any) => this.onShot(room.sessionId, msg));
  }

  private onShot(myId: string, msg: { from: { x: number; z: number }; to: { x: number; z: number }; victim: string }): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(msg.from.x, 1.2, msg.from.z),
      new THREE.Vector3(msg.to.x, 1.2, msg.to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee88, transparent: true }));
    this.scene.add(line);
    this.tracers.push({ line, bornAt: performance.now() });
    if (msg.victim === myId) {
      this.vignette.classList.remove('hidden');
      clearTimeout(this.vignetteTimer);
      this.vignetteTimer = window.setTimeout(() => this.vignette.classList.add('hidden'), VIGNETTE_MS);
    }
    this.click();
  }

  // опциональный щелчок без ассетов (спека 5)
  private click(): void {
    try {
      this.audio ??= new AudioContext();
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      gain.gain.setValueAtTime(0.08, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.06);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(this.audio.currentTime + 0.06);
    } catch { /* звук опционален, без него играбельно */ }
  }

  update(): void {
    const now = performance.now();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const k = 1 - (now - t.bornAt) / TRACER_MS;
      if (k <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        (t.line.material as THREE.LineBasicMaterial).opacity = k;
      }
    }
  }
}
