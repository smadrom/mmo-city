import type { InputController } from './input.js';

const STICK_RADIUS = 45; // px — ход нуба от центра базы

interface TouchHooks {
  attack(): void;
  interact(): void;
  togglePhone(): void;
  toggleMap(): void;
}

// Тач-управление: левый джойстик (движение/бег), свайп справа (камера), кнопки действий.
// Существует только на тач-устройствах; на десктопе конструктор ничего не показывает.
export class TouchControls {
  constructor(private input: InputController, hooks: TouchHooks) {
    if (!('ontouchstart' in window)) return;
    document.getElementById('touchUI')!.classList.remove('hidden');
    const stick = document.getElementById('stick')!;
    const nub = document.getElementById('nub')!;

    // id активных касаний (-1 = нет); объявлены до всех колбэков, чтобы TDZ не сработал
    let stickId = -1;
    let lookId = -1;
    let lastX = 0;

    // --- джойстик ---
    const moveStick = (tx: number, ty: number) => {
      const r = stick.getBoundingClientRect();
      let dx = (tx - (r.left + r.width / 2)) / STICK_RADIUS;
      let dy = (ty - (r.top + r.height / 2)) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.input.setTouchMove(dx, dy);
      nub.style.left = `${35 + dx * STICK_RADIUS}px`;
      nub.style.top = `${35 + dy * STICK_RADIUS}px`;
    };
    const resetStick = (): void => {
      this.input.setTouchMove(0, 0);
      nub.style.left = '35px';
      nub.style.top = '35px';
    };
    stick.addEventListener('touchstart', (e) => {
      const t0 = e.changedTouches[0];
      stickId = t0.identifier;
      moveStick(t0.clientX, t0.clientY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === stickId) moveStick(t0.clientX, t0.clientY);
      }
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === stickId) { stickId = -1; resetStick(); }
        if (t0.identifier === lookId) lookId = -1;
      }
    }, { passive: true });

    // --- камера: свайп по правой части экрана (не по кнопкам/оверлеям) ---
    window.addEventListener('touchstart', (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('#touchUI') || tgt.closest('#phone') || tgt.closest('#fullmap') || tgt.closest('button')) return;
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.clientX > window.innerWidth * 0.4 && lookId === -1 && t0.identifier !== stickId) {
          lookId = t0.identifier;
          lastX = t0.clientX;
        }
      }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      for (const t0 of Array.from(e.changedTouches)) {
        if (t0.identifier === lookId) {
          this.input.setTouchLook((t0.clientX - lastX) * 0.006);
          lastX = t0.clientX;
        }
      }
    }, { passive: true });

    // --- кнопки ---
    const onTap = (id: string, fn: () => void): void => {
      document.getElementById(id)!.addEventListener('touchstart', (e) => { e.preventDefault(); fn(); }, { passive: false });
    };
    onTap('btnAttack', hooks.attack);
    onTap('btnE', hooks.interact);
    onTap('btnRun', () => this.input.toggleTouchSprint());
    onTap('btnPhone', hooks.togglePhone);
    onTap('btnMap', hooks.toggleMap);
  }
}
