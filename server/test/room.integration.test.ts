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

  it('покупка оружия через buyWeapon у магазина', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'shoper', role: 'citizen' });
    const p = room.state.players.get(client.sessionId);
    const shop = createCityMap().gunShop;
    p.x = shop.x;
    p.z = shop.z;
    p.cash = 1000;
    let result: any = null;
    client.onMessage('shopResult', (msg) => { result = msg; });
    client.send('buyWeapon', { kind: 'pistol' });
    await new Promise(r => setTimeout(r, 200));
    expect(result).toEqual({ ok: true, reason: 'ok' });
    expect(p.weapon).toBe('pistol');
    expect(p.cash).toBe(400);
  });

  it('interact у магазина шлёт openShop', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'shoper2', role: 'citizen' });
    const p = room.state.players.get(client.sessionId);
    const shop = createCityMap().gunShop;
    p.x = shop.x;
    p.z = shop.z;
    let opened = false;
    client.onMessage('openShop', () => { opened = true; });
    client.send('interact');
    await new Promise(r => setTimeout(r, 200));
    expect(opened).toBe(true);
  });

  it('выстрел через attack: урон жертве и broadcast shot', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const shooter = await testServer.connectTo(room, { name: 'sh1', role: 'citizen' });
    const victim = await testServer.connectTo(room, { name: 'v1', role: 'citizen' });
    const ps = room.state.players.get(shooter.sessionId);
    const pv = room.state.players.get(victim.sessionId);
    // открытая местность без зданий (середина дороги), стрелок смотрит в -z
    ps.x = 0; ps.z = 50; ps.rotY = 0; ps.weapon = 'pistol'; ps.ammo = 10;
    pv.x = 0; pv.z = 30;
    let shot: any = null;
    victim.onMessage('shot', (msg) => { shot = msg; });
    shooter.send('attack');
    await new Promise(r => setTimeout(r, 200));
    expect(pv.hp).toBeLessThan(100);
    expect(shot?.hit).toBe(true);
    expect(shot?.victim).toBe(victim.sessionId);
  });
});
