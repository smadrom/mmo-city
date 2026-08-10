import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';
import { PROTOCOL_VERSION } from '@mmo/shared';
import { joinWithChar } from './helpers.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('одна комната (integration)', () => {
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

  it('два клиента попадают в одну и ту же комнату', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'sr1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'sr2', 'citizen');
    expect(c1.roomId).toBe(room.roomId); // colyseus.js Room: поле называется roomId (не id)
    expect(c2.roomId).toBe(room.roomId);
  });

  it('autoDispose=false: комната переживает полный выход игроков', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'sr3', 'citizen');
    await c1.leave();
    await wait(300);
    // room не выброшен colyseus'ом — хэндл жив, принимает новых игроков:
    const c2 = await joinWithChar(testServer, room, 'sr4', 'citizen');
    expect(c2.roomId).toBe(room.roomId); // та же комната, а не новая
    expect(room.state.players.get(c2.sessionId).name).toBe('sr4');
  });

  it('переполнение: maxClients=2, третий клиент отклоняется', async () => {
    const room = await testServer.createRoom<GameState>('city', { maxClients: 2 }) as any;
    await joinWithChar(testServer, room, 'full1', 'citizen');
    await joinWithChar(testServer, room, 'full2', 'citizen');
    await expect(testServer.connectTo(room, { email: 'full3@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })).rejects.toThrow();
  });
});
