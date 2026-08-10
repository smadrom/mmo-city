import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import { Player, type GameState } from '../src/schema/GameState.js';
import { PROTOCOL_VERSION, CHARACTER_LIMIT, COP_LIMIT } from '@mmo/shared';
import { joinWithChar, onceMessage } from './helpers.js';

const OPTS = (email: string) => ({ email, password: 'pw1234', ver: PROTOCOL_VERSION });

describe('персонажи/лобби (integration)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    process.env.GAME_DB = ':memory:';
    const gameServer = new Server();
    gameServer.define('city', CityRoom);
    testServer = await boot(gameServer);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  it('регистрация при входе: пустой charList, createChar спавнит с выбранной ролью', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await testServer.connectTo(room, OPTS('new@t.local'));
    const list = await onceMessage<{ chars: any[]; copFull: boolean }>(c, 'charList');
    expect(list.chars).toEqual([]);
    expect(list.copFull).toBe(false);
    expect(room.state.players.get(c.sessionId)).toBeUndefined(); // лобби — без Player
    const spawned = onceMessage(c, 'spawnOk');
    c.send('createChar', { name: 'hero', role: 'cop' });
    await spawned;
    const p = room.state.players.get(c.sessionId);
    expect(p.name).toBe('hero');
    expect(p.role).toBe('cop');
  });

  it('пустой email → need_email; слабый пароль нового аккаунта → weak_password; неверный → bad_password', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'anchor1'); // держит комнату
    await expect(testServer.connectTo(room, { ver: PROTOCOL_VERSION })).rejects.toThrow(/need_email/);
    await expect(testServer.connectTo(room, { email: 'weak@t.local', password: '123', ver: PROTOCOL_VERSION })).rejects.toThrow(/weak_password/);
    const c = await joinWithChar(testServer, room, 'pwduser');
    await c.leave();
    await new Promise(r => setTimeout(r, 200));
    await expect(testServer.connectTo(room, { email: 'pwduser@t.local', password: 'wrong1', ver: PROTOCOL_VERSION })).rejects.toThrow(/bad_password/);
  });

  it('второй одновременный вход того же аккаунта → account_online', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'dup');
    await expect(testServer.connectTo(room, OPTS('dup@t.local'))).rejects.toThrow(/account_online/);
  });

  it('лимит слотов: 9-й персонаж → slots_full', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    for (let i = 0; i < CHARACTER_LIMIT; i++) room.db.createChar('full@t.local', `slot${i}`, 'citizen');
    const c = await testServer.connectTo(room, OPTS('full@t.local'));
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'slot9', role: 'citizen' });
    expect((await err).code).toBe('slots_full');
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
  });

  it('ник занят другим аккаунтом → nick_taken; пустой ник → nick_bad; плохая роль → role_bad', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('other@t.local', 'taken', 'citizen');
    const c = await testServer.connectTo(room, OPTS('mine@t.local'));
    let err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'taken', role: 'citizen' });
    expect((await err).code).toBe('nick_taken');
    err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: '  ', role: 'citizen' });
    expect((await err).code).toBe('nick_bad');
    err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'okname', role: 'zombie' });
    expect((await err).code).toBe('role_bad');
  });

  it('cop_full: спавн копа при заполненном лимите отклоняется, гражданин проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // лимит копов заполнен фейковыми игроками (без runtime — тик их пропускает)
    for (let i = 0; i < COP_LIMIT; i++) {
      const fake = new Player();
      fake.name = `fakecop${i}`;
      fake.role = 'cop';
      room.state.players.set(`fake${i}`, fake);
    }
    const c = await testServer.connectTo(room, OPTS('copfan@t.local'));
    const list = await onceMessage<{ copFull: boolean }>(c, 'charList');
    expect(list.copFull).toBe(true);
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'copfan', role: 'cop' });
    expect((await err).code).toBe('cop_full');
    const spawned = onceMessage(c, 'spawnOk');
    c.send('createChar', { name: 'copfan', role: 'citizen' });
    await spawned;
    expect(room.state.players.get(c.sessionId).role).toBe('citizen');
  });

  it('selectChar чужого/несуществующего → not_found; свой — спавнит, роль из записи', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('other@t.local', 'theirs', 'cop');
    const c = await testServer.connectTo(room, OPTS('picker@t.local'));
    room.db.createChar('picker@t.local', 'mine', 'cop');
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('selectChar', { name: 'theirs' });
    expect((await err).code).toBe('not_found');
    const spawned = onceMessage(c, 'spawnOk');
    c.send('selectChar', { name: 'mine' });
    await spawned;
    expect(room.state.players.get(c.sessionId).role).toBe('cop'); // роль из записи персонажа
  });

  it('deleteChar: персонаж исчезает из charList, ник освобождается', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('owner@t.local', 'doomed', 'citizen');
    const c = await testServer.connectTo(room, OPTS('owner@t.local'));
    const first = await onceMessage<{ chars: any[] }>(c, 'charList'); // список из onJoin — с doomed
    expect(first.chars).toHaveLength(1);
    const list = onceMessage<{ chars: any[] }>(c, 'charList'); // свежий список после удаления
    c.send('deleteChar', { name: 'doomed' });
    expect((await list).chars).toEqual([]);
    expect(room.db.getChar('doomed')).toBeNull();
    expect(room.db.hasPlayer('doomed')).toBe(false);
  });

  it('забаненный ник: selectChar и createChar → banned, спавна нет', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.db.createChar('bad@t.local', 'badguy', 'citizen');
    room.db.ban('badguy', '', 'чит', Date.now() + 60_000, false); // временный
    room.db.ban('permNick', '', 'чит', null, false); // перманент — отдельный код
    const c = await testServer.connectTo(room, OPTS('bad@t.local'));
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('selectChar', { name: 'badguy' });
    expect((await err).code).toBe('banned');
    // createChar по забаненному нику (бан переживает удаление/несоздание):
    const err2 = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'permNick', role: 'citizen' });
    expect((await err2).code).toBe('banned_perm');
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
  });

  it('перезаход: прогресс персонажа на месте (selectChar после leave)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'persist');
    room.state.players.get(c1.sessionId).cash = 4321;
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    const c2 = await joinWithChar(testServer, room, 'persist'); // тот же email → selectChar
    expect(room.state.players.get(c2.sessionId).cash).toBe(4321);
  });
});
