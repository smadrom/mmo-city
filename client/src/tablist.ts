import { t } from './i18n/index.js';
import { isTypingTarget } from './input.js';
import type { Room } from 'colyseus.js';

// Список игроков по удержанию Tab: ник + роль, копы первыми. Ники — только textContent (XSS).
export class TabList {
  private root = document.getElementById('tablist')!;
  private open = false;
  private room!: Room;
  private refreshAt = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab' || e.repeat || isTypingTarget()) return;
      e.preventDefault(); // Tab не уводит фокус в браузерный chrome
      this.open = true;
      this.root.classList.remove('hidden');
      this.render();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Tab') return;
      this.open = false;
      this.root.classList.add('hidden');
    });
    // окно потеряло фокус с зажатым Tab — keyup не придёт, список зависнет
    window.addEventListener('blur', () => {
      this.open = false;
      this.root.classList.add('hidden');
    });
  }

  bind(room: Room): void {
    this.room = room;
  }

  update(): void {
    if (this.open && performance.now() - this.refreshAt > 1000) this.render();
  }

  private render(): void {
    this.refreshAt = performance.now();
    const rows: { name: string; role: string }[] = [];
    (this.room.state.players as any).forEach((p: any) => {
      if (p.role !== 'zombie') rows.push({ name: p.name, role: p.role });
    });
    rows.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'cop' ? -1 : 1));
    this.root.textContent = '';
    const title = document.createElement('div');
    title.className = 'tabTitle';
    title.textContent = `${t('tab.title')} (${rows.length})`;
    this.root.append(title);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = `tabRow ${r.role}`;
      const name = document.createElement('span');
      name.textContent = r.name;
      const role = document.createElement('span');
      role.textContent = t(`role.${r.role}`);
      row.append(name, role);
      this.root.append(row);
    }
  }
}
