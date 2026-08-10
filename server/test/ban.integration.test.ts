import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';
import { PROTOCOL_VERSION } from '@mmo/shared';
import { joinWithChar, onceMessage } from './helpers.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('бан при входе (integration)', () => {
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

  it('бан по нику: вход отклоняется, после unban — проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    (room as any).db.ban('badguy', '', 'чит', null, false);
    // ник-бан теперь ловится в лобби: аккаунт входит, но создать/выбрать ник нельзя
    const c = await testServer.connectTo(room, { email: 'x@t.local', password: 'pw1234', ver: PROTOCOL_VERSION });
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'badguy', role: 'citizen' });
    expect((await err).code).toMatch(/banned/);
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
    (room as any).db.unban('badguy');
    const spawned = onceMessage(c, 'spawnOk');
    c.send('createChar', { name: 'badguy', role: 'citizen' });
    await spawned;
    expect(room.state.players.get(c.sessionId).name).toBe('badguy');
  });

  it('истёкший бан не блокирует', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    (room as any).db.ban('wasbad', '', 'x', Date.now() - 1000, false);
    const c = await joinWithChar(testServer, room, 'wasbad', 'citizen');
    expect(room.state.players.has(c.sessionId)).toBe(true);
  });

  it('жёсткий бан по IP (byIp=1) блокирует любой ник с этого IP', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // сначала заходим «зондом» и читаем IP, который реально захватил сервер (127.0.0.1 или ::1)
    const probe = await joinWithChar(testServer, room, 'probe', 'citizen');
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    expect(ip).toBeTruthy(); // IP захватывается в onAuth
    (room as any).db.ban('cheater', ip, 'мультиакк', null, true);
    await expect(testServer.connectTo(room, { email: 'innocent@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })).rejects.toThrow(/banned/);
  });

  it('мягкий бан (byIp=0) по IP не блокирует другие ники', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const probe = await joinWithChar(testServer, room, 'probe2', 'citizen');
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    (room as any).db.ban('onlynick', ip, 'x', null, false); // бан ника, не IP
    const other = await joinWithChar(testServer, room, 'otherguy', 'citizen');
    expect(room.state.players.has(other.sessionId)).toBe(true);
    // забаненный ник: лобби отклоняет createChar
    const c = await testServer.connectTo(room, { email: 'y@t.local', password: 'pw1234', ver: PROTOCOL_VERSION });
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'onlynick', role: 'citizen' });
    expect((await err).code).toMatch(/banned/);
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
  });
});
