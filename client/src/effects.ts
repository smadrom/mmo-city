import * as THREE from 'three';
import type { Room } from 'colyseus.js';
import { dist2 } from '@mmo/shared';
import type { Avatars } from './avatars.js';

const TRACER_MS = 80;
const VIGNETTE_MS = 150;
const SHOT_SOUND_DIST = 60; // дальше этого радиуса щелчок не играем

interface Tracer { line: THREE.Line; bornAt: number }
interface DamageNumber { sprite: THREE.Sprite; bornAt: number }
const DAMAGE_MS = 700;

export class Effects {
  private tracers: Tracer[] = [];
  private damageNumbers: DamageNumber[] = [];
  private vignette = document.getElementById('vignette')!;
  private vignetteTimer = 0;
  private audio: AudioContext | null = null;
  muted = localStorage.getItem('mute') === '1'; // публичное: main.ts читает для тоста
  private prevMode = '';

  constructor(private scene: THREE.Scene, private room: Room, private avatars: Avatars) {
    room.onMessage('shot', (msg: any) => this.onShot(room.sessionId, msg));
    room.onMessage('hit', (msg: any) => this.onHit(msg));
    room.onMessage('swing', (msg: any) => this.avatars.playSwing(msg.player));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN' && !e.repeat) this.toggleMute();
    });
    room.onMessage('picked', (m: { kind: string }) => {
      // подбор: деньги — «монетка», остальное — короткий блип
      if (m.kind === 'cash') this.tone(660, 0.12, 'sine', 0.07, 990);
      else this.tone(520, 0.08, 'square', 0.05);
    });
  }

  private onShot(myId: string, msg: { from: { x: number; z: number }; to: { x: number; z: number }; victim: string; attacker?: string }): void {
    if (msg.attacker) this.avatars.playRecoil(msg.attacker);
    // сервер шлёт raw-позицию жертвы — она опережает интерполированный меш на ~120 мс;
    // рисуем конец tracer'а в меш, если он есть (спека: попадание должно попадать в видимую модель)
    const to = (msg.victim && this.avatars.meshPos(msg.victim)) || msg.to;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(msg.from.x, 1.2, msg.from.z),
      new THREE.Vector3(to.x, 1.2, to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee88, transparent: true }));
    this.scene.add(line);
    this.tracers.push({ line, bornAt: performance.now() });
    if (msg.victim === myId) {
      this.vignette.classList.remove('hidden');
      clearTimeout(this.vignetteTimer);
      this.vignetteTimer = window.setTimeout(() => this.vignette.classList.add('hidden'), VIGNETTE_MS);
    }
    const me = (this.room.state.players as any).get(myId);
    if (!me || dist2(msg.from.x, msg.from.z, me.x, me.z) <= SHOT_SOUND_DIST * SHOT_SOUND_DIST) this.tone(1200, 0.06, 'square', 0.06);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('mute', this.muted ? '1' : '0');
    return this.muted;
  }

  // доставка оплачена: восходящая «монетка» (main.ts дёргает на 'delivered')
  cashIn(): void {
    this.tone(523, 0.25, 'sine', 0.08, 1046);
  }

  // мини-синтез без ассетов: тон с экспоненциальным затуханием, опциональный слайд частоты
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.08, slideTo = 0): void {
    if (this.muted) return;
    try {
      this.audio ??= new AudioContext();
      const t0 = this.audio.currentTime;
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(t0 + dur);
    } catch { /* звук опционален, без него играбельно */ }
  }

  private onHit(msg: { victim: string; attacker?: string; damage: number; x: number; z: number }): void {
    const myId = this.room.sessionId;
    if (msg.attacker === myId && msg.victim !== myId) this.tone(880, 0.05, 'square', 0.05); // я попал
    if (msg.victim === myId) this.tone(140, 0.15, 'sawtooth', 0.09); // по мне
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(`-${msg.damage}`, 64, 32);
    ctx.fillStyle = '#ff5544';
    ctx.fillText(`-${msg.damage}`, 64, 32);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.scale.set(1.4, 0.7, 1);
    sprite.position.set(msg.x + (Math.random() - 0.5) * 0.6, 2.3, msg.z);
    this.scene.add(sprite);
    this.damageNumbers.push({ sprite, bornAt: performance.now() });
  }

  update(me?: { mode: string }): void {
    if (me && me.mode === 'dead' && this.prevMode !== 'dead') this.tone(300, 0.5, 'sawtooth', 0.09, 60); // моя смерть
    if (me) this.prevMode = me.mode;
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
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      const t = (now - d.bornAt) / DAMAGE_MS;
      if (t >= 1) {
        this.scene.remove(d.sprite);
        const m = d.sprite.material as THREE.SpriteMaterial;
        m.map?.dispose();
        m.dispose();
        this.damageNumbers.splice(i, 1);
      } else {
        d.sprite.position.y = 2.3 + t * 0.7;
        (d.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
      }
    }
  }
}
