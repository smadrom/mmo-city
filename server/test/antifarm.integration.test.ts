import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';
import { joinWithChar } from './helpers.js';

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
    const c1 = await joinWithChar(testServer, room, 'farm1', 'citizen');
    await joinWithChar(testServer, room, 'farm2', 'citizen');
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
    const c1 = await joinWithChar(testServer, room, 'pt1', 'citizen');
    (room as any).lastPlaytimeAt = 0; // форсируем начисление на ближайшем тике (спавн через лобби мог опоздать к первому)
    await wait(150);
    const rt = (room as any).runtimes.get(c1.sessionId);
    expect(rt.playtimeSec).toBeGreaterThanOrEqual(60);
    rt.playtimeSec = 4321;
    (room as any).savePlayer(c1.sessionId);
    expect((room as any).db.getPlaytime('pt1')).toBe(4321);
  });

  it('наигрыш восстанавливается при повторном входе', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    await joinWithChar(testServer, room, 'ptAnchor', 'citizen'); // держит комнату
    const c1 = await joinWithChar(testServer, room, 'pt2', 'citizen');
    await wait(150);
    (room as any).runtimes.get(c1.sessionId).playtimeSec = 999;
    (room as any).savePlayer(c1.sessionId);
    await c1.leave();
    await wait(200);
    const c2 = await joinWithChar(testServer, room, 'pt2'); // тот же email → selectChar
    expect((room as any).runtimes.get(c2.sessionId).playtimeSec).toBe(999);
  });

  it('суточный IP-лимит: 800+800 с одного IP → второй перевод ip_limit', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await joinWithChar(testServer, room, 'whale1', 'citizen');
    await joinWithChar(testServer, room, 'whale2', 'citizen');
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
    const c1 = await joinWithChar(testServer, room, 'old1', 'citizen');
    await joinWithChar(testServer, room, 'old2', 'citizen');
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
