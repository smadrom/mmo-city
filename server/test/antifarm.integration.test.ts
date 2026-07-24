import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('антимультиаккаунт (integration)', () => {
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

  it('перевод без наигрыша 30 мин → need_playtime', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'farm1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'farm2', role: 'citizen' });
    room.state.players.get(c1.sessionId).cash = 500;
    (room as any).savePlayer(c1.sessionId);
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'farm2', amount: 100 });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'need_playtime' });
  });

  it('наигрыш копится тиками и персистится через savePlayer', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'pt1', role: 'citizen' });
    await wait(150); // первый же тик накидывает +60 (lastPlaytimeAt стартует с 0)
    const rt = (room as any).runtimes.get(c1.sessionId);
    expect(rt.playtimeSec).toBeGreaterThanOrEqual(60);
    rt.playtimeSec = 4321;
    (room as any).savePlayer(c1.sessionId);
    expect((room as any).db.getPlaytime('pt1')).toBe(4321);
  });

  it('наигрыш восстанавливается при повторном входе', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await testServer.connectTo(room, { name: 'ptAnchor', role: 'citizen' }); // держит комнату
    const c1 = await testServer.connectTo(room, { name: 'pt2', role: 'citizen' });
    let tok = '';
    c1.onMessage('authToken', (m: any) => { tok = m.token; });
    await wait(150);
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 999;
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await wait(200);
    const c2 = await testServer.connectTo(room, { name: 'pt2', role: 'citizen', token: tok });
    expect((room as any).runtimes.get(c2.sessionId).playtimeSec).toBe(999);
  });

  it('суточный IP-лимит: 800+800 с одного IP → второй перевод ip_limit', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'whale1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'whale2', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 5000;
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 99999;
    (room as any).savePlayer(c1.sessionId);
    const results: any[] = [];
    c1.onMessage('transferResult', (m) => results.push(m));
    c1.send('transfer', { to: 'whale2', amount: 800 });
    await wait(600); // пережать writeRateLimited (500 мс)
    c1.send('transfer', { to: 'whale2', amount: 800 });
    await wait(300);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({ ok: false, error: 'ip_limit' });
  });

  it('записи старше 24 ч не считаются в IP-лимит', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'old1', role: 'citizen' });
    await testServer.connectTo(room, { name: 'old2', role: 'citizen' });
    const p1 = room.state.players.get(c1.sessionId);
    p1.cash = 5000;
    const rt = (room as any).runtimes.get(c1.sessionId);
    rt.playtimeSec = 99999;
    (room as any).savePlayer(c1.sessionId);
    // «вчерашний» перевод с того же IP напрямую в лог
    (room as any).db.transfer('old1', 'old2', 999, Date.now() - 25 * 3600_000, rt.ip);
    let result: any = null;
    c1.onMessage('transferResult', (m) => { result = m; });
    c1.send('transfer', { to: 'old2', amount: 900 });
    await wait(300);
    expect(result).toMatchObject({ ok: true });
  });
});
