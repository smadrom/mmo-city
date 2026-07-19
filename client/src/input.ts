import type { Room } from 'colyseus.js';
import type { MoveInput } from '@mmo/shared';

export class InputController {
  yaw = 0;
  // текущее состояние ввода — читается предсказанием каждый кадр (refresh)
  readonly current: MoveInput = { up: false, down: false, left: false, right: false, sprint: false, rotY: 0 };
  private keys = new Set<string>();

  private isTyping(): boolean {
    return document.activeElement === document.getElementById('chatInput');
  }

  constructor(private room: Room, dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping()) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') room.send('interact');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // потеря фокуса окна/вкладки — keyup не приходит, клавиши «залипают» → сброс
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear();
    });

    dom.addEventListener('click', () => {
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else room.send('attack');
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) this.yaw -= e.movementX * 0.003;
    });

    setInterval(() => {
      if (this.isTyping()) this.keys.clear(); // стоим, пока печатаем
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
