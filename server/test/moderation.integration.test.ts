import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';
import { CityRoom } from '../src/rooms/CityRoom.js';
import type { GameState } from '../src/schema/GameState.js';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('модерация: мут/автомут/цензура (integration)', () => {
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

  it('мут блокирует чат: сообщение не рассылается, приходит notice', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'muted1', role: 'citizen' });
    const c2 = await testServer.connectTo(room, { name: 'listen1', role: 'citizen' });
    (room as any).db.mute('muted1', Date.now() + 60_000, 'тест');
    const got: any[] = [];
    let notice: any = null;
    c1.onMessage('notice', (m) => { notice = m; });
    c1.onMessage('chat', (m) => got.push(m));
    c2.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: 'меня слышно?' });
    await wait(200);
    expect(got).toHaveLength(0);
    expect(notice?.text).toContain('замьючены');
  });

  it('мут блокирует SMS: smsResult error=muted', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'muted2', role: 'citizen' });
    await testServer.connectTo(room, { name: 'smspeer', role: 'citizen' });
    (room as any).db.mute('muted2', Date.now() + 60_000, 'тест');
    let result: any = null;
    c1.onMessage('smsResult', (m) => { result = m; });
    c1.send('sms', { to: 'smspeer', text: 'привет' });
    await wait(200);
    expect(result).toMatchObject({ ok: false, error: 'muted' });
  });

  it('автомут: 5 срабатываний чат-кулдауна за минуту → мут на 10 мин', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'flooder', role: 'citizen' });
    c1.onMessage('chat', () => {}); // гасим warning
    for (let i = 0; i < 6; i++) {
      c1.send('chat', { text: `флуд ${i}` }); // первое проходит, 5 следующих — кулдаун
      await wait(30);
    }
    await wait(200);
    const mute = (room as any).db.getActiveMute('flooder', Date.now());
    expect(mute).not.toBeNull();
    expect(mute.reason).toContain('спам');
  });

  it('цензура: мат в чате уходит замаскированным', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'rude1', role: 'citizen' });
    const got: any[] = [];
    c1.onMessage('chat', (m) => got.push(m));
    c1.send('chat', { text: 'сука, опять лаги' });
    await wait(200);
    expect(got[0].text).toBe('****, опять лаги');
  });

  it('цензура: мат в SMS маскируется до записи в БД', async () => {
    const room = await testServer.createRoom<GameState>('city') as any;
    const c1 = await testServer.connectTo(room, { name: 'rude2', role: 'citizen' });
    await testServer.connectTo(room, { name: 'rude3', role: 'citizen' });
    c1.onMessage('smsResult', () => {});
    c1.send('sms', { to: 'rude3', text: 'ты мудак' });
    await wait(200);
    const thread = (room as any).db.getThread('rude2', 'rude3', 10);
    expect(thread[0].text).toBe('ты *****');
  });
});
