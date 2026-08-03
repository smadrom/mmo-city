import * as THREE from 'three';
import type { Room } from 'colyseus.js';
import { dist2 } from '@mmo/shared';
import type { Avatars } from './avatars.js';
import { isTypingTarget } from './input.js';

const TRACER_MS = 80;
const VIGNETTE_MS = 150;
const SHOT_SOUND_DIST = 60; // дальше этого радиуса щелчок не играем
const SKIDMARK_MS = 10_000; // время жизни следа шин

interface Tracer { line: THREE.Line; bornAt: number }
interface DamageNumber { sprite: THREE.Sprite; bornAt: number }
const DAMAGE_MS = 700;

export class Effects {
  private tracers: Tracer[] = [];
  private damageNumbers: DamageNumber[] = [];
  private vignette = document.getElementById('vignette')!;
  private vignetteTimer = 0;
  private hitmarker = document.getElementById('hitmarker')!;
  private hitmarkerTimer = 0;
  private dmgDir = document.getElementById('dmgDir')!;
  private dmgDirTimer = 0;
  private audio: AudioContext | null = null;
  muted = localStorage.getItem('mute') === '1'; // публичное: main.ts читает для тоста
  volume = (() => { const v = Number(localStorage.getItem('vol') ?? '1'); return Number.isFinite(v) ? v : 1; })(); // '0' — валидная громкость, не схлопываем в 1
  private prevMode = '';
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private lastSkidAt = 0;
  private skidmarks: { mesh: THREE.Mesh; bornAt: number }[] = [];
  private skidmat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.6 });

  private room!: Room; // не readonly: реконнект переприсваивает через bind

  constructor(private scene: THREE.Scene, room: Room, private avatars: Avatars) {
    this.bind(room);
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget()) return; // не глушим звук при печати в чате/полях
      if (e.code === 'KeyN' && !e.repeat) this.toggleMute();
    });
  }

  // реконнект: сообщения подписываем на новую комнату (DOM-слушатель N остаётся в конструкторе)
  bind(room: Room): void {
    this.room = room;
    room.onMessage('shot', (msg: any) => this.onShot(room.sessionId, msg));
    room.onMessage('hit', (msg: any) => this.onHit(msg));
    room.onMessage('swing', (msg: any) => this.avatars.playSwing(msg.player));
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

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('vol', String(this.volume));
  }

  // доставка оплачена: восходящая «монетка» (main.ts дёргает на 'delivered')
  cashIn(): void {
    this.tone(523, 0.25, 'sine', 0.08, 1046);
  }

  // мотор своей машины: зацикленный пилой, питч/громкость от скорости
  engineStart(): void {
    if (this.engineOsc || this.muted) return;
    try {
      this.audio ??= new AudioContext();
      this.engineOsc = this.audio.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(50, this.audio.currentTime);
      this.engineGain = this.audio.createGain();
      this.engineGain.gain.setValueAtTime(0.0001, this.audio.currentTime);
      this.engineOsc.connect(this.engineGain).connect(this.audio.destination);
      this.engineOsc.start();
    } catch { this.engineOsc = null; this.engineGain = null; }
  }
  engineUpdate(speed: number): void {
    if (!this.engineOsc || !this.engineGain || !this.audio) return;
    this.engineOsc.frequency.setTargetAtTime(40 + Math.abs(speed) * 3, this.audio.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(Math.min(0.06, 0.015 + Math.abs(speed) * 0.0015) * this.volume, this.audio.currentTime, 0.1);
  }
  engineStop(): void {
    try { this.engineOsc?.stop(); } catch { /* уже остановлен */ }
    this.engineOsc = null;
    this.engineGain = null;
  }

  skid(): void { // визг шин, не чаще раза в 600 мс
    const now = performance.now();
    if (now - this.lastSkidAt < 600) return;
    this.lastSkidAt = now;
    this.tone(900, 0.3, 'sawtooth', 0.04, 400);
  }
  crash(): void { this.tone(90, 0.25, 'square', 0.1, 40); } // удар о стену

  // тёмная полоска под машиной при резком торможении (детект по патчам в main, своя и чужие)
  addSkidmark(x: number, z: number, rotY: number): void {
    if (this.skidmarks.length > 200) {
      const old = this.skidmarks.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose(); // материал — клон skidmat, свой у каждой полоски
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.6), this.skidmat.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotY;
    mesh.position.set(x, 0.035, z);
    this.scene.add(mesh);
    this.skidmarks.push({ mesh, bornAt: performance.now() });
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
      gain.gain.setValueAtTime(vol * this.volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(t0 + dur);
    } catch { /* звук опционален, без него играбельно */ }
  }

  private onHit(msg: { victim: string; attacker?: string; damage: number; x: number; z: number }): void {
    const myId = this.room.sessionId;
    if (msg.attacker === myId && msg.victim !== myId) {
      this.tone(880, 0.05, 'square', 0.05); // я попал
      this.flashHitmarker();
    }
    if (msg.victim === myId) {
      this.tone(140, 0.15, 'sawtooth', 0.09); // по мне
      this.showDamageFrom(msg.attacker ?? '');
    }
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

  // белый × в центре на 150 мс — подтверждение своего попадания
  private flashHitmarker(): void {
    this.hitmarker.classList.remove('hidden');
    clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => this.hitmarker.classList.add('hidden'), 150);
  }

  // красный клин со стороны атакующего (400 мс): угол = направление на него относительно моего rotY
  private showDamageFrom(attackerId: string): void {
    const me = (this.room.state.players as any).get(this.room.sessionId);
    const att = attackerId ? (this.room.state.players as any).get(attackerId) : null;
    if (!me || !att) return;
    const ang = Math.atan2(att.x - me.x, att.z - me.z) - me.rotY;
    // π - ang: 0 = атакующий прямо по курсу (клин сверху), проверено по осям (rotY: forward=(-sin,-cos))
    this.dmgDir.style.transform = `translate(-50%, -50%) rotate(${Math.PI - ang}rad)`;
    this.dmgDir.classList.remove('hidden');
    clearTimeout(this.dmgDirTimer);
    this.dmgDirTimer = window.setTimeout(() => this.dmgDir.classList.add('hidden'), 400);
  }

  update(me?: { mode: string }, carSpeed = 0): void {
    if (me && me.mode === 'dead' && this.prevMode !== 'dead') this.tone(300, 0.5, 'sawtooth', 0.09, 60); // моя смерть
    if (me) this.prevMode = me.mode;
    // мотор звучит только в машине и не при mute; вышел/умер/заглушил звук — стоп
    if (me && me.mode === 'car' && !this.muted) {
      this.engineStart();
      this.engineUpdate(carSpeed);
    } else {
      this.engineStop();
    }
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
    // следы шин: живут 10 с, гаснут по остатку времени
    for (let i = this.skidmarks.length - 1; i >= 0; i--) {
      const s = this.skidmarks[i];
      const k = 1 - (now - s.bornAt) / SKIDMARK_MS;
      if (k <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose(); // клон skidmat — чужой не трогаем
        this.skidmarks.splice(i, 1);
      } else {
        (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * k;
      }
    }
  }
}
