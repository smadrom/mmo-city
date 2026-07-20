import { describe, it, expect } from 'vitest';
import { GameState, Player } from '../src/schema/GameState.js';
import { makeRuntime, type Runtime } from '../src/runtime.js';
import { GameDB } from '../src/db.js';
import { trySms } from '../src/systems/messages.js';
import { SMS_MAX_LEN, SMS_COOLDOWN_MS } from '@mmo/shared';

function setup() {
  const state = new GameState();
  const p = new Player();
  p.name = 'sender';
  state.players.set('s1', p);
  const runtimes = new Map<string, Runtime>([['s1', makeRuntime(0)]]);
  const db = new GameDB(':memory:');
  db.load('sender');
  db.load('receiver');
  return { state, p, runtimes, db };
}

describe('SMS', () => {
  it('валидное SMS: пишется в БД, возвращает SmsOut, lastSmsAt обновлён', () => {
    const { state, runtimes, db } = setup();
    const res = trySms(state, runtimes, db, 's1', 'receiver', 'привет', 10_000);
    expect(res.error).toBeUndefined();
    expect(res.sms).toMatchObject({ from: 'sender', to: 'receiver', text: 'привет', ts: 10_000 });
    expect(res.sms!.id).toBeGreaterThan(0);
    expect(runtimes.get('s1')!.lastSmsAt).toBe(10_000);
    expect(db.getThread('sender', 'receiver', 50)).toHaveLength(1);
  });

  it('trim ника и текста', () => {
    const { state, runtimes, db } = setup();
    const res = trySms(state, runtimes, db, 's1', '  receiver  ', '  хай  ', 1000);
    expect(res.sms).toMatchObject({ to: 'receiver', text: 'хай' });
  });

  it('плохой ник → bad_to; себе → self; нет в БД → no_such_user', () => {
    const { state, runtimes, db } = setup();
    expect(trySms(state, runtimes, db, 's1', '', 'хай', 1000).error).toBe('bad_to');
    expect(trySms(state, runtimes, db, 's1', 42, 'хай', 1000).error).toBe('bad_to');
    expect(trySms(state, runtimes, db, 's1', 'a'.repeat(17), 'хай', 1000).error).toBe('bad_to');
    expect(trySms(state, runtimes, db, 's1', 'sender', 'хай', 1000).error).toBe('self');
    expect(trySms(state, runtimes, db, 's1', 'ghost', 'хай', 1000).error).toBe('no_such_user');
  });

  it('пустой/длинный текст → bad_text', () => {
    const { state, runtimes, db } = setup();
    expect(trySms(state, runtimes, db, 's1', 'receiver', '   ', 1000).error).toBe('bad_text');
    expect(trySms(state, runtimes, db, 's1', 'receiver', 'я'.repeat(SMS_MAX_LEN + 1), 1000).error).toBe('bad_text');
    expect(trySms(state, runtimes, db, 's1', 'receiver', 'я'.repeat(SMS_MAX_LEN), 1000).error).toBeUndefined();
  });

  it('антиспам: второе SMS в пределах SMS_COOLDOWN_MS → cooldown', () => {
    const { state, runtimes, db } = setup();
    expect(trySms(state, runtimes, db, 's1', 'receiver', 'один', 10_000).error).toBeUndefined();
    expect(trySms(state, runtimes, db, 's1', 'receiver', 'два', 10_000 + SMS_COOLDOWN_MS - 1).error).toBe('cooldown');
    expect(trySms(state, runtimes, db, 's1', 'receiver', 'три', 10_000 + SMS_COOLDOWN_MS).error).toBeUndefined();
  });

  it('отклонённое SMS не пишется в БД', () => {
    const { state, runtimes, db } = setup();
    trySms(state, runtimes, db, 's1', 'ghost', 'хай', 1000);
    expect(db.getThread('sender', 'ghost', 50)).toHaveLength(0);
  });
});
