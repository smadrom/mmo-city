import type { Room } from 'colyseus.js';

export class InputController {
  yaw = 0;
  private keys = new Set<string>();

  constructor(private room: Room, dom: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE') room.send('interact');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    dom.addEventListener('click', () => {
      if (document.pointerLockElement !== dom) dom.requestPointerLock();
      else room.send('attack');
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) this.yaw -= e.movementX * 0.003;
    });

    setInterval(() => {
      room.send('input', {
        up: this.keys.has('KeyW'),
        down: this.keys.has('KeyS'),
        left: this.keys.has('KeyA'),
        right: this.keys.has('KeyD'),
        sprint: this.keys.has('ShiftLeft'),
        rotY: this.yaw,
      });
    }, 50);
  }
}
