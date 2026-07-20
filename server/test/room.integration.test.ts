import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { createCityMap, CAR_ENTER_DIST, ZOMBIE_COUNT, PUNCH_DAMAGE } from '@mmo/shared';
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
    expect(room.state.players.size).toBe(1 + ZOMBIE_COUNT); // 20 зомби спавнятся в onCreate
    const p = room.state.players.get(client.sessionId);
    expect(p.name).toBe('int1');
    expect(p.cash).toBe(500);
  });

  it('ввод двигает игрока', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
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

  it('input с rotY=Infinity отбрасывается в конечное значение', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await testServer.connectTo(room, { name: 'rotbad', role: 'citizen' });
    client.send('input', { up: true, down: false, left: false, right: false, sprint: false, rotY: Infinity });
    await new Promise(r => setTimeout(r, 200));
    const p = room.state.players.get(client.sessionId);
    expect(Number.isFinite(p.rotY)).toBe(true);
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
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
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
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
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

  it('зомби создаются в комнате и не пишутся в БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    let zombies = 0;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') zombies++; });
    expect(zombies).toBe(ZOMBIE_COUNT);
    const z0 = room.state.players.get('z0');
    z0.cash = 777;
    (room as any).savePlayer('z0');
    expect((room as any).db.load('Зомби').cash).not.toBe(777); // запись не создалась/не обновилась
  });

  it('удар кулаком: broadcast hit жертве и swing всем', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
    const c1 = await testServer.connectTo(room, { name: 'boxer', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'target', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    const p2 = room.state.players.get(c2.sessionId);
    p1.x = 0; p1.z = 0; p1.rotY = 0;
    p2.x = 0; p2.z = -1.5;
    let hit: any = null;
    let swing: any = null;
    c2.onMessage('hit', (m) => { hit = m; });
    c1.onMessage('swing', (m) => { swing = m; });
    c1.send('attack');
    await new Promise(r => setTimeout(r, 200));
    expect(hit?.victim).toBe(c2.sessionId);
    expect(hit?.damage).toBe(PUNCH_DAMAGE);
    expect(swing?.player).toBe(c1.sessionId);
  });

  it('пикап подбирается на сервере: игрок на точке получает оружие', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
    const client = await testServer.connectTo(room, { name: 'lucky', role: 'citizen' });
    const p = room.state.players.get(client.sessionId);
    const pk = [...room.state.pickups.values()][0] as any;
    pk.kind = 'rifle';
    p.x = pk.x; p.z = pk.z;
    await new Promise(r => setTimeout(r, 200));
    expect(p.weapon).toBe('rifle');
    expect(pk.active).toBe(false);
  });

  it('чат: сообщение доставляется другим игрокам (и отправителю-эхом)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'chatter1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'chatter2', role: 'citizen' });
    const got: any[] = [];
    c1.onMessage('chat', (m) => got.push(m)); // эхо отправителю
    c2.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: 'привет, город' });
    await new Promise(r => setTimeout(r, 200));
    expect(got).toHaveLength(2);
    expect(got[0].from).toBe('chatter1');
    expect(got[0].text).toBe('привет, город');
  });

  it('чат: история по запросу chatHistoryReq', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'old1', role: 'citizen' });
    c1.onMessage('chat', () => {}); // гасим warning о неподписанном сообщении
    c1.send('chat', { text: 'раннее сообщение' });
    await new Promise(r => setTimeout(r, 200));
    const c2 = await testServer.connectTo(room, { name: 'newbie1', role: 'citizen' });
    let history: any = null;
    c2.onMessage('chatHistory', (msg) => { history = msg; });
    c2.send('chatHistoryReq');
    await new Promise(r => setTimeout(r, 200));
    expect(history.items).toHaveLength(1);
    expect(history.items[0].text).toBe('раннее сообщение');
  });

  it('чат: антиспам и пустое сообщение молча отсекаются', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'spammer', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'listener', role: 'citizen' });
    const got: any[] = [];
    c1.onMessage('chat', (m) => got.push(m));
    c2.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: '   ' });      // пустое после trim
    c1.send('chat', { text: 'первое' });   // проходит
    c1.send('chat', { text: 'второе' });   // в пределах cooldown — режется
    await new Promise(r => setTimeout(r, 300));
    expect(got).toHaveLength(2); // «первое» эхом отправителю + слушателю
    expect(got[0].text).toBe('первое');
  });

  it('чат: повторный chatHistoryReq в пределах 5 сек молча игнорируется', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'histspam', role: 'citizen' });
    let count = 0;
    c1.onMessage('chatHistory', () => { count++; });
    c1.send('chatHistoryReq');
    c1.send('chatHistoryReq');
    await new Promise(r => setTimeout(r, 200));
    expect(count).toBe(1);
  });

  it('чат: буфер истории держит последние 20 (21-е вытесняет первое)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'hist1', role: 'citizen' });
    c1.onMessage('chat', () => {}); // гасим warning о неподписанном типе
    for (let i = 1; i <= 21; i++) {
      (room as any).runtimes.get(c1.sessionId).lastChatAt = -10_000; // обход антиспама ради скорости теста
      c1.send('chat', { text: `msg${i}` });
      await new Promise(r => setTimeout(r, 30));
    }
    let history: any = null;
    c1.onMessage('chatHistory', (m) => { history = m; });
    c1.send('chatHistoryReq');
    await new Promise(r => setTimeout(r, 200));
    expect(history.items).toHaveLength(20);
    expect(history.items[0].text).toBe('msg2');
    expect(history.items[19].text).toBe('msg21');
  });
});
