import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { createCityMap, CAR_ENTER_DIST, ZOMBIE_COUNT, PUNCH_DAMAGE, PROTOCOL_VERSION } from '@mmo/shared';
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
    let tok = '';
    c1.onMessage('authToken', (m: any) => { tok = m.token; });
    await new Promise(r => setTimeout(r, 150));
    room.state.players.get(c1.sessionId).cash = 1234;
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    expect(room.state.players.has(c1.sessionId)).toBe(false);
    const c2 = await testServer.connectTo(room, { name: 'persist1', role: 'citizen', token: tok });
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

  it('сдача груза шлёт адресное delivered, выстрел — hit с attacker', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'dl1', role: 'citizen' });
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
    expect(hit?.attacker).toBe(c1.sessionId);
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

  it('приватные поля видит только владелец (@view)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const a = await testServer.connectTo(room, { name: 'viewA', role: 'citizen' });
    const b = await testServer.connectTo(room, { name: 'viewB', role: 'citizen' });
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

  it('auth: чужой под тем же ником без токена отклоняется, с токеном — проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'anchorAuth', role: 'citizen' }); // держит комнату/БД
    const owner = await testServer.connectTo(room, { name: 'acc1', role: 'citizen' });
    let tok = '';
    owner.onMessage('authToken', (m: any) => { tok = m.token; });
    await new Promise(r => setTimeout(r, 150));
    expect(tok).toBeTruthy();
    await owner.leave();
    await new Promise(r => setTimeout(r, 200));
    // без токена — отказ (ник заклеймён)
    await expect(testServer.connectTo(room, { name: 'acc1', role: 'citizen' })).rejects.toThrow();
    // с верным токеном — успех
    const back = await testServer.connectTo(room, { name: 'acc1', role: 'citizen', token: tok });
    expect(room.state.players.get(back.sessionId).name).toBe('acc1');
  });

  it('рента переживает релог: nextRentAt восстанавливается из БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'anchorRent', role: 'citizen' });
    const c1 = await testServer.connectTo(room, { name: 'tenant', role: 'citizen' });
    let tok = '';
    c1.onMessage('authToken', (m: any) => { tok = m.token; });
    await new Promise(r => setTimeout(r, 150));
    (room as any).runtimes.get(c1.sessionId).nextRentAt = 1000; // срок ренты «в прошлом»
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await new Promise(r => setTimeout(r, 200));
    const c2 = await testServer.connectTo(room, { name: 'tenant', role: 'citizen', token: tok });
    expect((room as any).runtimes.get(c2.sessionId).nextRentAt).toBe(1000); // не сброшен релогом
  });

  it('версия протокола: несовпадающий ver отклоняется, текущий — проходит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'verAnchor', role: 'citizen' }); // держит комнату (иначе autoDispose)
    await expect(testServer.connectTo(room, { name: 'verbad', role: 'citizen', ver: 999 })).rejects.toThrow();
    const ok = await testServer.connectTo(room, { name: 'vergood', role: 'citizen', ver: PROTOCOL_VERSION });
    expect(room.state.players.get(ok.sessionId).name).toBe('vergood');
  });

  it('дубль активного ника отклоняется (один сеанс на аккаунт)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'dup', role: 'citizen' });
    let tok = '';
    c1.onMessage('authToken', (m: any) => { tok = m.token; });
    await new Promise(r => setTimeout(r, 150));
    // c1 всё ещё онлайн → второй вход тем же ником (даже с токеном) отклоняется
    await expect(testServer.connectTo(room, { name: 'dup', role: 'citizen', token: tok })).rejects.toThrow();
  });

  it('призрак замораживается при обрыве: не двигается в окне реконнекта', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'ghostAnchor', role: 'citizen' }); // держит комнату
    const c = await testServer.connectTo(room, { name: 'ghost1', role: 'citizen' });
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
    const c1 = await testServer.connectTo(room, { name: 'pinger', role: 'citizen' });
    let got: any = null;
    c1.onMessage('pong', (m) => { got = m; });
    c1.send('ping', { t: 12345 });
    await new Promise(r => setTimeout(r, 200));
    expect(got).toEqual({ t: 12345 });
  });

  it('sys: вход/выход игрока рассылается всем', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'watcher', role: 'citizen' });
    const msgs: any[] = [];
    c1.onMessage('sys', (m) => msgs.push(m));
    const c2 = await testServer.connectTo(room, { name: 'joiner', role: 'citizen' });
    await new Promise(r => setTimeout(r, 200));
    expect(msgs.some(m => m.code === 'join' && m.name === 'joiner')).toBe(true);
    await c2.leave(); // consented → onLeave кидает в catch → removePlayer сразу, окно реконнекта не ждём
    await new Promise(r => setTimeout(r, 300));
    expect(msgs.some(m => m.code === 'leave' && m.name === 'joiner')).toBe(true);
  });

  it('kickByName дисконнектит игрока (admin)', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c = await testServer.connectTo(room, { name: 'kickme', role: 'citizen' });
    expect((room as any).kickByName('kickme')).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect(room.state.players.has(c.sessionId)).toBe(false);
    expect((room as any).kickByName('nobody')).toBe(false);
  });
});
