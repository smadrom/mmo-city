import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { createCityMap, CAR_ENTER_DIST } from '@mmo/shared';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

describe('CityRoom (integration)', () => {
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

  it('игрок заходит и появляется в состоянии комнаты', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'int1', role: 'citizen' });
    expect(room.state.players.size).toBe(1);
    const p = room.state.players.get(client.sessionId);
    expect(p.name).toBe('int1');
    expect(p.cash).toBe(500);
  });

  it('ввод двигает игрока', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'int2', role: 'citizen' });
    const before = room.state.players.get(client.sessionId).z;
    client.send('input', { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 });
    await new Promise(r => setTimeout(r, 500));
    const after = room.state.players.get(client.sessionId).z;
    expect(after).toBeLessThan(before);
  });

  it('битое input-сообщение не роняет комнату', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'int3', role: 'citizen' });
    client.send('input');
    await new Promise(r => setTimeout(r, 200));
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });

  it('лимит копов: 21-й коп становится гражданином', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const clients = [];
    for (let i = 0; i < 21; i++) {
      clients.push(await testServer.connectTo(room, { name: `cop${i}`, role: 'cop' }));
    }
    const roles = new Set<string>();
    room.state.players.forEach((p: any) => roles.add(p.role));
    let cops = 0;
    room.state.players.forEach((p: any) => { if (p.role === 'cop') cops++; });
    expect(cops).toBe(20);
  });

  it('вход в машину через interact у парковки', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'driver1', role: 'citizen' });
    const spot = createCityMap().parkingSpots[0];
    const p = room.state.players.get(client.sessionId);
    // ставим игрока к первому парковочному месту, в пределах CAR_ENTER_DIST
    p.x = spot.x + CAR_ENTER_DIST - 2;
    p.z = spot.z;
    client.send('interact');
    await new Promise(r => setTimeout(r, 200));
    expect(p.mode).toBe('car');
    expect(p.carId).toBe(spot.id);
  });

  it('кэш переживает переподключение с тем же ником', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    // якорный клиент держит комнату (и её in-memory БД) живой между подключениями
    await testServer.connectTo(room, { name: 'anchor', role: 'citizen' });
    const c1 = await testServer.connectTo(room, { name: 'persist1', role: 'citizen' });
    room.state.players.get(c1.sessionId).cash = 1234;
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    expect(room.state.players.has(c1.sessionId)).toBe(false);
    const c2 = await testServer.connectTo(room, { name: 'persist1', role: 'citizen' });
    expect(room.state.players.get(c2.sessionId).cash).toBe(1234);
  });
});
