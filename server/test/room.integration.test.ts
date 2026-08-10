import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { createCityMap, CAR_ENTER_DIST, ZOMBIE_COUNT, PUNCH_DAMAGE, PROTOCOL_VERSION } from '@mmo/shared';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';
import { joinWithChar, onceMessage } from './helpers.js';

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
    const client = await joinWithChar(testServer, room, 'int1', 'citizen');
    expect(room.state.players.size).toBe(1 + ZOMBIE_COUNT); // 20 зомби спавнятся в onCreate
    const p = room.state.players.get(client.sessionId);
    expect(p.name).toBe('int1');
    expect(p.cash).toBe(500);
  });

  it('ввод двигает игрока', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
    const client = await joinWithChar(testServer, room, 'int2', 'citizen');
    const before = room.state.players.get(client.sessionId).z;
    client.send('input', { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 });
    await new Promise(r => setTimeout(r, 500));
    const after = room.state.players.get(client.sessionId).z;
    expect(after).toBeLessThan(before);
  });

  it('битое input-сообщение не роняет комнату', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await joinWithChar(testServer, room, 'int3', 'citizen');
    client.send('input');
    await new Promise(r => setTimeout(r, 200));
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });

  it('input с rotY=Infinity отбрасывается в конечное значение', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await joinWithChar(testServer, room, 'rotbad', 'citizen');
    client.send('input', { up: true, down: false, left: false, right: false, sprint: false, rotY: Infinity });
    await new Promise(r => setTimeout(r, 200));
    const p = room.state.players.get(client.sessionId);
    expect(Number.isFinite(p.rotY)).toBe(true);
  });

  it('лимит копов: 21-й коп отклоняется лобби (cop_full)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    for (let i = 0; i < 20; i++) {
      await joinWithChar(testServer, room, `cop${i}`, 'cop');
    }
    // 21-й коп: создание копа в лобби отклоняется, спавна нет
    const c = await testServer.connectTo(room, { email: 'cop20@t.local', password: 'pw1234', ver: PROTOCOL_VERSION });
    const err = onceMessage<{ code: string }>(c, 'lobbyError');
    c.send('createChar', { name: 'cop20', role: 'cop' });
    expect((await err).code).toBe('cop_full');
    expect(room.state.players.get(c.sessionId)).toBeUndefined();
    let cops = 0;
    room.state.players.forEach((p: any) => { if (p.role === 'cop') cops++; });
    expect(cops).toBe(20);
  });

  it('вход в машину через interact у парковки', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
    const client = await joinWithChar(testServer, room, 'driver1', 'citizen');
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
    await joinWithChar(testServer, room, 'anchor', 'citizen');
    const c1 = await joinWithChar(testServer, room, 'persist1', 'citizen');
    room.state.players.get(c1.sessionId).cash = 1234;
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    expect(room.state.players.has(c1.sessionId)).toBe(false);
    const c2 = await joinWithChar(testServer, room, 'persist1'); // тот же email → selectChar
    expect(room.state.players.get(c2.sessionId).cash).toBe(1234);
  });

  it('покупка оружия через buyWeapon у магазина', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const client = await joinWithChar(testServer, room, 'shoper', 'citizen');
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
    const client = await joinWithChar(testServer, room, 'shoper2', 'citizen');
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
    const shooter = await joinWithChar(testServer, room, 'sh1', 'citizen');
    const victim = await joinWithChar(testServer, room, 'v1', 'citizen');
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

  it('сдача груза шлёт адресное delivered, выстрел — hit с attacker', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'dl1', 'citizen');
    // delivered: проставить груз вручную и подвезти к точке
    const p = room.state.players.get(c1.sessionId);
    p.mode = 'car';
    p.cargo = true;
    p.deliveryTarget = 'shop';
    p.deliveryDeadline = Date.now() + 60_000;
    let got: any = null;
    c1.onMessage('delivered', (m) => { got = m; });
    const t = (room as any).map.deliveryTargets.find((t: any) => t.id === 'shop');
    p.x = t.x; p.z = t.z;
    // запас по таймингу: тик 20 Гц, ждём 400 мс вместо 200
    await new Promise(r => setTimeout(r, 400));
    expect(got?.reward).toBeGreaterThan(0);
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
    const c1 = await joinWithChar(testServer, room, 'boxer', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'target', 'citizen');
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
    expect(hit?.attacker).toBe(c1.sessionId);
    expect(swing?.player).toBe(c1.sessionId);
  });

  it('пикап подбирается на сервере: игрок на точке получает оружие', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    room.state.players.forEach((p: any) => { if (p.role === 'zombie') { p.x = 190; p.z = 190; } }); // отгоняем зомби
    const client = await joinWithChar(testServer, room, 'lucky', 'citizen');
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
    const c1 = await joinWithChar(testServer, room, 'chatter1', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'chatter2', 'citizen');
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
    const c1 = await joinWithChar(testServer, room, 'old1', 'citizen');
    c1.onMessage('chat', () => {}); // гасим warning о неподписанном сообщении
    c1.send('chat', { text: 'раннее сообщение' });
    await new Promise(r => setTimeout(r, 200));
    const c2 = await joinWithChar(testServer, room, 'newbie1', 'citizen');
    let history: any = null;
    c2.onMessage('chatHistory', (msg) => { history = msg; });
    c2.send('chatHistoryReq');
    await new Promise(r => setTimeout(r, 200));
    expect(history.items).toHaveLength(1);
    expect(history.items[0].text).toBe('раннее сообщение');
  });

  it('чат: антиспам и пустое сообщение молча отсекаются', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'spammer', 'citizen');
    const c2 = await joinWithChar(testServer, room, 'listener', 'citizen');
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
    const c1 = await joinWithChar(testServer, room, 'histspam', 'citizen');
    let count = 0;
    c1.onMessage('chatHistory', () => { count++; });
    c1.send('chatHistoryReq');
    c1.send('chatHistoryReq');
    await new Promise(r => setTimeout(r, 200));
    expect(count).toBe(1);
  });

  it('чат: буфер истории держит последние 20 (21-е вытесняет первое)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'hist1', 'citizen');
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

  it('приватные поля видит только владелец (@view)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const a = await joinWithChar(testServer, room, 'viewA', 'citizen');
    const b = await joinWithChar(testServer, room, 'viewB', 'citizen');
    // серверная авторитетная величина
    room.state.players.get(a.sessionId).cash = 999;
    room.state.players.get(a.sessionId).ammo = 42;
    await new Promise(r => setTimeout(r, 300)); // дать патчам дойти до клиента A
    const meOnA = (a.state.players as any).get(a.sessionId);
    const otherOnA = (a.state.players as any).get(b.sessionId);
    // свой cash/ammo реплицирован владельцу…
    expect(meOnA.cash).toBe(999);
    expect(meOnA.ammo).toBe(42);
    // …а чужие приватные поля НЕ утекают (клиент их вообще не получает → undefined)
    expect(otherOnA.cash).toBeUndefined();
    expect(otherOnA.ammo).toBeUndefined();
    // публичные поля чужого игрока при этом видны
    expect(otherOnA.name).toBe('viewB');
  });

  it('рента переживает релог: nextRentAt восстанавливается из БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'anchorRent', 'citizen');
    const c1 = await joinWithChar(testServer, room, 'tenant', 'citizen');
    (room as any).runtimes.get(c1.sessionId).nextRentAt = 1000; // срок ренты «в прошлом»
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    const c2 = await joinWithChar(testServer, room, 'tenant'); // тот же email → selectChar
    expect((room as any).runtimes.get(c2.sessionId).nextRentAt).toBe(1000); // не сброшен релогом
  });

  it('версия протокола: несовпадающий ver отклоняется, текущий — проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'verAnchor', 'citizen'); // держит комнату (иначе autoDispose)
    await expect(testServer.connectTo(room, { email: 'verbad@t.local', password: 'pw1234', ver: 999 })).rejects.toThrow();
    const ok = await joinWithChar(testServer, room, 'vergood');
    expect(room.state.players.get(ok.sessionId).name).toBe('vergood');
  });

  it('второй одновременный вход аккаунта отклоняется (account_online)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'dup', 'citizen');
    // аккаунт всё ещё онлайн → второй вход тем же email отклоняется
    await expect(testServer.connectTo(room, { email: 'dup@t.local', password: 'pw1234', ver: PROTOCOL_VERSION })).rejects.toThrow(/account_online/);
  });

  it('призрак замораживается при обрыве: не двигается в окне реконнекта', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'ghostAnchor', 'citizen'); // держит комнату
    const c = await joinWithChar(testServer, room, 'ghost1', 'citizen');
    const id = c.sessionId;
    const p = room.state.players.get(id);
    p.x = 190; p.z = 190; // подальше от зомби/копов
    (room as any).runtimes.get(id).input = { up: true, down: false, left: false, right: false, sprint: false, rotY: 0 };
    await c.leave(false); // обрыв соединения (не consented) → onLeave(consented=false)
    await new Promise(r => setTimeout(r, 300));
    expect((room as any).runtimes.get(id)?.frozen).toBe(true);
    const zBefore = room.state.players.get(id)?.z;
    await new Promise(r => setTimeout(r, 400));
    expect(room.state.players.get(id)?.z).toBe(zBefore); // заморожен: input=up, но не движется
  });

  it('ping отвечает pong с тем же payload', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'pinger', 'citizen');
    let got: any = null;
    c1.onMessage('pong', (m) => { got = m; });
    c1.send('ping', { t: 12345 });
    await new Promise(r => setTimeout(r, 200));
    expect(got).toEqual({ t: 12345 });
  });

  it('sys: вход/выход игрока рассылается всем', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'watcher', 'citizen');
    const msgs: any[] = [];
    c1.onMessage('sys', (m) => msgs.push(m));
    const c2 = await joinWithChar(testServer, room, 'joiner', 'citizen');
    await new Promise(r => setTimeout(r, 200));
    expect(msgs.some(m => m.code === 'join' && m.name === 'joiner')).toBe(true);
    await c2.leave(); // consented → onLeave кидает в catch → removePlayer сразу, окно реконнекта не ждём
    await new Promise(r => setTimeout(r, 300));
    expect(msgs.some(m => m.code === 'leave' && m.name === 'joiner')).toBe(true);
  });

  it('kickByName дисконнектит игрока (admin)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await joinWithChar(testServer, room, 'kickme', 'citizen');
    expect((room as any).kickByName('kickme')).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(room.state.players.has(c.sessionId)).toBe(false);
    expect((room as any).kickByName('nobody')).toBe(false);
  });
});
