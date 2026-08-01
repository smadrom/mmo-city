import type { Room } from 'colyseus.js';
import type { MoveInput } from '@mmo/shared';

export function isTypingTarget(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
}

export class InputController {
  yaw = 0;
  aiming = false;
  // текущее состояние ввода — читается предсказанием каждый кадр (refresh)
  readonly current: MoveInput = { up: false, down: false, left: false, right: false, sprint: false, rotY: 0 };
  private keys = new Set<string>();
  private blocked = false; // оверлей (телефон/карта) — игровой ввод глушим
  private touch = { x: 0, y: 0 }; // джойстик -1..1 (тач)
  private touchSprint = false;    // кнопка «Бег» — тоггл (тач)

  // открыт ли чужой оверлей (настройки/телефон/карта) — хоткеи P/M поверх него не открываются
  isBlocked(): boolean { return this.blocked; }

  setBlocked(v: boolean): void {
    this.blocked = v;
    if (v) {
      this.keys.clear(); this.aiming = false;
      this.touch = { x: 0, y: 0 }; this.touchSprint = false; // тач-стейт глушим вместе с клавишами
      this.refresh();
    }
  }

  setTouchMove(x: number, y: number): void { this.touch.x = x; this.touch.y = y; }
  setTouchLook(dYaw: number): void { this.yaw += dYaw; }
  toggleTouchSprint(): void { this.touchSprint = !this.touchSprint; }

  constructor(private room: Room, dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget() || this.blocked) return;
      if (e.repeat) return; // автоповтор зажатой клавиши (зажатый E не шлёт interact подряд)
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.room.send('interact');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // потеря фокуса окна/вкладки — keyup не приходит, клавиши «залипают» → сброс
    window.addEventListener('blur', () => { this.keys.clear(); this.aiming = false; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear();
    });

    dom.addEventListener('click', () => {
      if (this.blocked) return; // оверлей закрывается только своей клавишей — клик по canvas под ним игнорируем
      if ('ontouchstart' in window) { this.room.send('attack'); return; } // на таче pointer lock нет — тап = атака
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else this.room.send('attack');
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) this.yaw -= e.movementX * 0.003;
    });
    dom.addEventListener('mousedown', (e) => { if (e.button === 2) this.aiming = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) this.aiming = false; });
    dom.addEventListener('contextmenu', (e) => e.preventDefault()); // без меню по ПКМ

    setInterval(() => {
      if (isTypingTarget() || this.blocked) this.keys.clear(); // стоим, пока печатаем / открыт оверлей
      this.refresh();
      this.room.send('input', this.current);
    }, 50);
  }

  // реконнект: новая комната — шлем input в неё (слушатели DOM не привязаны к room)
  setRoom(room: Room): void {
    this.room = room;
  }

  refresh(): void {
    const t = this.touch;
    this.current.up = this.keys.has('KeyW') || t.y < -0.3;
    this.current.down = this.keys.has('KeyS') || t.y > 0.3;
    this.current.left = this.keys.has('KeyA') || t.x < -0.3;
    this.current.right = this.keys.has('KeyD') || t.x > 0.3;
    this.current.sprint = this.keys.has('ShiftLeft') || this.touchSprint || Math.hypot(t.x, t.y) > 0.92;
    this.current.rotY = this.yaw;
  }
}
