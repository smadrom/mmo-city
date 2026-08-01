import type { Room } from 'colyseus.js';

const MAX_LINES = 5;
const TTL_MS = 5000;

// kill feed: серверные kill/bounty/arrest — правый верхний угол, строки тают за 5 сек
export class Feed {
  private root = document.getElementById('feed')!;

  bind(room: Room): void {
    room.onMessage('feed', (m: { kind: string; a: string; b: string }) => this.add(m));
  }

  private add(m: { kind: string; a: string; b: string }): void {
    const div = document.createElement('div');
    div.textContent = m.kind === 'arrest' ? `${m.a} арестовал ${m.b}`
      : m.kind === 'bounty' ? `${m.a} ☠ ${m.b} (+25$)`
      : `${m.a} ☠ ${m.b}`; // Task 14 заменит на t() — литералы осознанно временные
    this.root.append(div);
    while (this.root.children.length > MAX_LINES) this.root.firstElementChild?.remove();
    setTimeout(() => div.remove(), TTL_MS);
  }
}
