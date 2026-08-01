import type { Room } from 'colyseus.js';
import { BOUNTY_REWARD } from '@mmo/shared';
import { t } from './i18n/index.js';

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
    div.textContent = m.kind === 'arrest' ? t('feed.arrest', { a: m.a, b: m.b })
      : m.kind === 'bounty' ? t('feed.bounty', { a: m.a, b: m.b, reward: BOUNTY_REWARD })
      : t('feed.kill', { a: m.a, b: m.b });
    this.root.append(div);
    while (this.root.children.length > MAX_LINES) this.root.firstElementChild?.remove();
    setTimeout(() => div.remove(), TTL_MS);
  }
}
