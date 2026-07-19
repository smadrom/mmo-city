import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { tryChat } from '../src/systems/chat.js';
import { CHAT_MAX_LEN, CHAT_COOLDOWN_MS } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'talker';
  state.serverTime = 777;
  state.players.set('s1', p);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  return { state, p, runtimes };
}

describe('чат', () => {
  it('валидное сообщение: {from, text, t}, lastChatAt обновлён', () => {
    const { state, runtimes } = setup();
    const msg = tryChat(state, runtimes, 's1', 'привет', 10_000);
    expect(msg).toEqual({ from: 'talker', text: 'привет', t: 777 });
    expect(runtimes.get('s1')!.lastChatAt).toBe(10_000);
  });

  it('trim пробелов по краям', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 's1', '  хай  ', 1000)?.text).toBe('хай');
  });

  it('пустое после trim отклоняется', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 's1', '   ', 1000)).toBeNull();
    expect(tryChat(state, runtimes, 's1', '', 1000)).toBeNull();
  });

  it('не-строка отклоняется', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 's1', 42, 1000)).toBeNull();
    expect(tryChat(state, runtimes, 's1', undefined, 1000)).toBeNull();
  });

  it('граница длины: CHAT_MAX_LEN можно, +1 нельзя', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 's1', 'я'.repeat(CHAT_MAX_LEN + 1), 1000)).toBeNull();
    expect(tryChat(state, runtimes, 's1', 'я'.repeat(CHAT_MAX_LEN), 1000)).not.toBeNull();
  });

  it('антиспам: второе сообщение в пределах CHAT_COOLDOWN_MS отклоняется', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 's1', 'один', 10_000)).not.toBeNull();
    expect(tryChat(state, runtimes, 's1', 'два', 10_000 + CHAT_COOLDOWN_MS - 1)).toBeNull();
    expect(tryChat(state, runtimes, 's1', 'три', 10_000 + CHAT_COOLDOWN_MS)).not.toBeNull();
  });

  it('неизвестный игрок → null', () => {
    const { state, runtimes } = setup();
    expect(tryChat(state, runtimes, 'ghost', 'хай', 1000)).toBeNull();
  });
});
