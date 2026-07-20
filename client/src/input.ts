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

  setBlocked(v: boolean): void {
    this.blocked = v;
    if (v) { this.keys.clear(); this.aiming = false; this.refresh(); }
  }

  constructor(private room: Room, dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget() || this.blocked) return;
      if (e.repeat) return; // автоповтор зажатой клавиши (зажатый E не шлёт interact подряд)
      this.keys.add(e.code);
      if (e.code === 'KeyE') room.send('interact');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // потеря фокуса окна/вкладки — keyup не приходит, клавиши «залипают» → сброс
    window.addEventListener('blur', () => { this.keys.clear(); this.aiming = false; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear();
    });

    dom.addEventListener('click', () => {
      if (this.blocked) return; // оверлей закрывается только своей клавишей — клик по canvas под ним игнорируем
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else room.send('attack');
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
      room.send('input', this.current);
    }, 50);
  }

  refresh(): void {
    this.current.up = this.keys.has('KeyW');
    this.current.down = this.keys.has('KeyS');
    this.current.left = this.keys.has('KeyA');
    this.current.right = this.keys.has('KeyD');
    this.current.sprint = this.keys.has('ShiftLeft');
    this.current.rotY = this.yaw;
  }
}
