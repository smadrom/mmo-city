import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

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
    const c1 = await testServer.connectTo(room, { name: 'sr1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'sr2', role: 'citizen' });
    expect(c1.roomId).toBe(room.roomId); // colyseus.js Room: поле называется roomId (не id)
    expect(c2.roomId).toBe(room.roomId);
  });

  it('autoDispose=false: комната переживает полный выход игроков', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'sr3', role: 'citizen' });
    await c1.leave();
    await wait(300);
    // room не выброшен colyseus'ом — хэндл жив, принимает новых игроков:
    const c2 = await testServer.connectTo(room, { name: 'sr4', role: 'citizen' });
    expect(c2.roomId).toBe(room.roomId); // та же комната, а не новая
    expect(room.state.players.get(c2.sessionId).name).toBe('sr4');
  });

  it('переполнение: maxClients=2, третий клиент отклоняется', async () => {
    const room = await testServer.createRoom<GameState>('city', { maxClients: 2 }) as any;
    await testServer.connectTo(room, { name: 'full1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'full2', role: 'citizen' });
    await expect(testServer.connectTo(room, { name: 'full3', role: 'citizen' })).rejects.toThrow();
  });
});
