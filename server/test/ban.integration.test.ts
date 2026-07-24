import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

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
    await expect(testServer.connectTo(room, { name: 'badguy', role: 'citizen' })).rejects.toThrow(/banned/);
    (room as any).db.unban('badguy');
    const ok = await testServer.connectTo(room, { name: 'badguy', role: 'citizen' });
    expect(room.state.players.get(ok.sessionId).name).toBe('badguy');
  });

  it('истёкший бан не блокирует', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    (room as any).db.ban('wasbad', '', 'x', Date.now() - 1000, false);
    const c = await testServer.connectTo(room, { name: 'wasbad', role: 'citizen' });
    expect(room.state.players.has(c.sessionId)).toBe(true);
  });

  it('жёсткий бан по IP (byIp=1) блокирует любой ник с этого IP', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // сначала заходим «зондом» и читаем IP, который реально захватил сервер (127.0.0.1 или ::1)
    const probe = await testServer.connectTo(room, { name: 'probe', role: 'citizen' });
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    expect(ip).toBeTruthy(); // IP захватывается в onAuth
    (room as any).db.ban('cheater', ip, 'мультиакк', null, true);
    await expect(testServer.connectTo(room, { name: 'innocent', role: 'citizen' })).rejects.toThrow(/banned/);
  });

  it('мягкий бан (byIp=0) по IP не блокирует другие ники', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const probe = await testServer.connectTo(room, { name: 'probe2', role: 'citizen' });
    const ip = (room as any).runtimes.get(probe.sessionId).ip;
    (room as any).db.ban('onlynick', ip, 'x', null, false); // бан ника, не IP
    const other = await testServer.connectTo(room, { name: 'otherguy', role: 'citizen' });
    expect(room.state.players.has(other.sessionId)).toBe(true);
    await expect(testServer.connectTo(room, { name: 'onlynick', role: 'citizen' })).rejects.toThrow(/banned/);
  });
});
